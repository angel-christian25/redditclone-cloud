const User = require('../models/user');
const Post = require('../models/post');
const { s3, BUCKET_NAME } = require('../utils/s3Config');
const paginateResults = require('../utils/paginateResults');
const { v4: uuidv4 } = require('uuid'); // For generating unique filenames

const getUser = async (req, res) => {
  const { username } = req.params;
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);

  const user = await User.findOne({
    username: { $regex: new RegExp('^' + username + '$', 'i') },
  });

  if (!user) {
    return res
      .status(404)
      .send({ message: `Username '${username}' does not exist on server.` });
  }

  const postsCount = await Post.find({ author: user.id }).countDocuments();
  const paginated = paginateResults(page, limit, postsCount);
  const userPosts = await Post.find({ author: user.id })
    .sort({ createdAt: -1 })
    .select('-comments')
    .limit(limit)
    .skip(paginated.startIndex)
    .populate('author', 'username')
    .populate('subreddit', 'subredditName');

  const paginatedPosts = {
    previous: paginated.results.previous,
    results: userPosts,
    next: paginated.results.next,
  };

  res.status(200).json({ userDetails: user, posts: paginatedPosts });
};

const setUserAvatar = async (req, res) => {
  const { avatarImage } = req.body;

  if (!avatarImage) {
    return res
      .status(400)
      .send({ message: 'Image URL needed for setting avatar.' });
  }

  const user = await User.findById(req.user);

  if (!user) {
    return res
      .status(404)
      .send({ message: 'User does not exist in database.' });
  }

  try {
    // Generate a unique file name
    const fileName = `${uuidv4()}.jpg`; // Adjust extension as needed
    const base64Data = new Buffer.from(avatarImage.replace(/^data:image\/\w+;base64,/, ""), 'base64');
    
    const params = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: base64Data,
      ContentEncoding: 'base64',
      ContentType: 'image/jpeg' // Adjust content type based on your file
    };

    const uploadResult = await s3.upload(params).promise();

    user.avatar = {
      exists: true,
      imageLink: uploadResult.Location,
      imageId: uploadResult.Key,
    };

    const savedUser = await user.save();
    res.status(201).json({ avatar: savedUser.avatar });
  } catch (error) {
    res.status(500).send({ message: 'Error uploading image to S3: ' + error.message });
  }
};

const removeUserAvatar = async (req, res) => {
  const user = await User.findById(req.user);

  if (!user) {
    return res
      .status(404)
      .send({ message: 'User does not exist in database.' });
  }

  if (user.avatar.exists) {
    const params = {
      Bucket: BUCKET_NAME,
      Key: user.avatar.imageId
    };

    try {
      await s3.deleteObject(params).promise();
      user.avatar = {
        exists: false,
        imageLink: 'null',
        imageId: 'null',
      };

      await user.save();
      res.status(204).end();
    } catch (error) {
      res.status(500).send({ message: 'Error deleting image from S3: ' + error.message });
    }
  } else {
    res.status(404).send({ message: 'No avatar to remove.' });
  }
};

module.exports = { getUser, setUserAvatar, removeUserAvatar };
