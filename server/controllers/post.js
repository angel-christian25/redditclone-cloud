const Post = require('../models/post');
const Subreddit = require('../models/subreddit');
const User = require('../models/user');
const postTypeValidator = require('../utils/postTypeValidator');
const { s3, BUCKET_NAME } = require('../utils/s3Config');
const paginateResults = require('../utils/paginateResults');
const { v4: uuidv4 } = require('uuid'); // For generating unique file names

const getPosts = async (req, res) => {
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);
  const sortBy = req.query.sortby;

  let sortQuery;
  switch (sortBy) {
    case 'new':
      sortQuery = { createdAt: -1 };
      break;
    case 'top':
      sortQuery = { pointsCount: -1 };
      break;
    case 'best':
      sortQuery = { voteRatio: -1 };
      break;
    case 'hot':
      sortQuery = { hotAlgo: -1 };
      break;
    case 'controversial':
      sortQuery = { controversialAlgo: -1 };
      break;
    case 'old':
      sortQuery = { createdAt: 1 };
      break;
    default:
      sortQuery = {};
  }

  const postsCount = await Post.countDocuments();
  const paginated = paginateResults(page, limit, postsCount);
  const allPosts = await Post.find({})
    .sort(sortQuery)
    .select('-comments')
    .limit(limit)
    .skip(paginated.startIndex)
    .populate('author', 'username')
    .populate('subreddit', 'subredditName');

  const paginatedPosts = {
    previous: paginated.results.previous,
    results: allPosts,
    next: paginated.results.next,
  };

  res.status(200).json(paginatedPosts);
};

const getSubscribedPosts = async (req, res) => {
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);

  const user = await User.findById(req.user);
  if (!user) {
    return res
      .status(404)
      .send({ message: 'User does not exist in database.' });
  }

  const subscribedSubs = await Subreddit.find({
    _id: { $in: user.subscribedSubs },
  });

  const postsCount = subscribedSubs
    .map((s) => s.posts.length)
    .reduce((sum, s) => s + sum, 0);

  const paginated = paginateResults(page, limit, postsCount);
  const subscribedPosts = await Post.find({
    subreddit: { $in: user.subscribedSubs },
  })
    .sort({ hotAlgo: -1 })
    .select('-comments')
    .limit(limit)
    .skip(paginated.startIndex)
    .populate('author', 'username')
    .populate('subreddit', 'subredditName');

  const paginatedPosts = {
    previous: paginated.results.previous,
    results: subscribedPosts,
    next: paginated.results.next,
  };

  res.status(200).json(paginatedPosts);
};

const getSearchedPosts = async (req, res) => {
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);
  const query = req.query.query;

  const findQuery = {
    $or: [
      {
        title: {
          $regex: query,
          $options: 'i',
        },
      },
      {
        textSubmission: {
          $regex: query,
          $options: 'i',
        },
      },
    ],
  };

  const postsCount = await Post.find(findQuery).countDocuments();
  const paginated = paginateResults(page, limit, postsCount);
  const searchedPosts = await Post.find(findQuery)
    .sort({ hotAlgo: -1 })
    .select('-comments')
    .limit(limit)
    .skip(paginated.startIndex)
    .populate('author', 'username')
    .populate('subreddit', 'subredditName');

  const paginatedPosts = {
    previous: paginated.results.previous,
    results: searchedPosts,
    next: paginated.results.next,
  };

  res.status(200).json(paginatedPosts);
};

const getPostAndComments = async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id);
  if (!post) {
    return res
      .status(404)
      .send({ message: `Post with ID: '${id}' does not exist in database.` });
  }

  const populatedPost = await post
    .populate('author', 'username')
    .populate('subreddit', 'subredditName')
    .populate('comments.commentedBy', 'username')
    .populate('comments.replies.repliedBy', 'username')
    .execPopulate();

  res.status(200).json(populatedPost);
};

const createNewPost = async (req, res) => {
  const {
    title,
    subreddit,
    postType,
    textSubmission,
    linkSubmission,
    imageSubmission,
  } = req.body;

  console.log('Received request to create a new post with details:', {
    title,
    subreddit,
    postType,
    textSubmission,
    linkSubmission,
    imageSubmission,
  });

  const validatedFields = postTypeValidator(
    postType,
    textSubmission,
    linkSubmission,
    imageSubmission
  );

  try {
    // Fetch user and subreddit from the database
    const author = await User.findById(req.user);
    const targetSubreddit = await Subreddit.findById(subreddit);

    if (!author) {
      console.error('User not found in database.');
      return res
        .status(404)
        .send({ message: 'User does not exist in database.' });
    }

    if (!targetSubreddit) {
      console.error(`Subreddit with ID: '${subreddit}' does not exist in database.`);
      return res.status(404).send({
        message: `Subreddit with ID: '${subreddit}' does not exist in database.`,
      });
    }

    // Create new post object
    const newPost = new Post({
      title,
      subreddit,
      author: author._id,
      upvotedBy: [author._id],
      pointsCount: 1,
      ...validatedFields,
    });

    // Handle image upload if the post type is 'Image'
    if (postType === 'Image' && imageSubmission) {
      console.log('Handling image upload to S3...');

      // Extract base64 data and content type from data URL
      const getImageTypeFromDataUrl = (dataUrl) => {
        const matches = dataUrl.match(/^data:(image\/(.+));base64,/);
        if (matches) {
          return {
            mimeType: matches[1],
            extension: matches[2],
          };
        }
        return { mimeType: 'image/jpeg', extension: 'jpeg' }; // Default fallback
      };

      const { mimeType, extension } = getImageTypeFromDataUrl(imageSubmission);
      const base64Data = imageSubmission.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `${uuidv4()}.${extension}`;

      const params = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: buffer,
        ContentType: mimeType,
      };

      try {
        const uploadedImage = await s3.upload(params).promise();
        console.log('Image uploaded successfully:', uploadedImage);
        newPost.imageSubmission = {
          imageLink: uploadedImage.Location,
          imageId: uploadedImage.Key,
        };
      } catch (error) {
        console.error('Error uploading image to S3:', error.message);
        console.error('Request parameters:', params);
        return res.status(401).send({ message: error.message });
      }
    }

    // Save the post
    const savedPost = await newPost.save();
    console.log('Post saved successfully:', savedPost);

    // Update subreddit and author
    targetSubreddit.posts = targetSubreddit.posts.concat(savedPost._id);
    await targetSubreddit.save();

    author.posts = author.posts.concat(savedPost._id);
    author.karmaPoints.postKarma++;
    await author.save();

    // Populate the post with author and subreddit details
    const populatedPost = await savedPost
      .populate('author', 'username')
      .populate('subreddit', 'subredditName')
      .execPopulate();

    console.log('Post populated successfully:', populatedPost);
    res.status(201).json(populatedPost);
  } catch (err) {
    console.error('Error creating new post:', err);
    res.status(500).send({ message: 'Internal server error' });
  }
};

const updatePost = async (req, res) => {
  const { id } = req.params;
  const { textSubmission, linkSubmission, imageSubmission } = req.body;

  try {
    const post = await Post.findById(id);
    const author = await User.findById(req.user);

    if (!post) {
      return res.status(404).send({
        message: `Post with ID: ${id} does not exist in database.`,
      });
    }

    if (!author) {
      return res.status(404).send({ message: 'User does not exist in database.' });
    }

    if (post.author.toString() !== author._id.toString()) {
      return res.status(401).send({ message: 'Access is denied.' });
    }

    const validatedFields = postTypeValidator(
      post.postType,
      textSubmission,
      linkSubmission,
      imageSubmission
    );

    switch (post.postType) {
      case 'Text':
        post.textSubmission = validatedFields.textSubmission;
        break;

      case 'Link':
        post.linkSubmission = validatedFields.linkSubmission;
        break;

      case 'Image': {
        if (imageSubmission) {
          console.log('Handling image upload to S3...');

          // Extract base64 content and MIME type from data URL
          const getImageTypeFromDataUrl = (dataUrl) => {
            const matches = dataUrl.match(/^data:(image\/(.+));base64,/);
            if (matches) {
              return {
                mimeType: matches[1],
                extension: matches[2],
              };
            }
            return { mimeType: 'image/jpeg', extension: 'jpeg' }; // Default fallback
          };

          const { mimeType, extension } = getImageTypeFromDataUrl(imageSubmission);
          const base64Data = imageSubmission.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          const fileName = `${uuidv4()}.${extension}`;

          const params = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: buffer,
            ContentType: mimeType,
          };

          try {
            const uploadedImage = await s3.upload(params).promise();
            console.log('Image uploaded successfully:', uploadedImage);
            post.imageSubmission = {
              imageLink: uploadedImage.Location,
              imageId: uploadedImage.Key,
            };
          } catch (error) {
            console.error('Error uploading image to S3:', error.message);
            console.error('Request parameters:', params);
            return res.status(401).send({ message: error.message });
          }
        }
        break;
      }

      default:
        return res.status(403).send({ message: 'Invalid post type.' });
    }

    post.updatedAt = Date.now();

    const savedPost = await post.save();
    const populatedPost = await savedPost
      .populate('author', 'username')
      .populate('subreddit', 'subredditName')
      .populate('comments.commentedBy', 'username')
      .populate('comments.replies.repliedBy', 'username')
      .execPopulate();

    res.status(202).json(populatedPost);
  } catch (err) {
    console.error('Error updating post:', err);
    res.status(500).send({ message: 'Internal server error' });
  }
};


const deletePost = async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id);
  const author = await User.findById(req.user);

  if (!post) {
    return res.status(404).send({
      message: `Post with ID: ${id} does not exist in database.`,
    });
  }

  if (!author) {
    return res
      .status(404)
      .send({ message: 'User does not exist in database.' });
  }

  if (post.author.toString() !== author._id.toString()) {
    return res.status(401).send({ message: 'Access is denied.' });
  }

  const subreddit = await Subreddit.findById(post.subreddit);

  if (!subreddit) {
    return res.status(404).send({
      message: `Subreddit with ID: '${subreddit._id}' does not exist in database.`,
    });
  }

  // Delete image from S3 if it exists
  if (post.imageSubmission && post.imageSubmission.imageId) {
    const params = {
      Bucket: BUCKET_NAME,
      Key: post.imageSubmission.imageId,
    };

    try {
      await s3.deleteObject(params).promise();
    } catch (error) {
      console.error('Error deleting image from S3:', error);
    }
  }

  await Post.findByIdAndDelete(id);

  subreddit.posts = subreddit.posts.filter((p) => p.toString() !== id);
  await subreddit.save();

  author.posts = author.posts.filter((p) => p.toString() !== id);
  await author.save();

  res.status(204).end();
};

module.exports = {
  getPosts,
  getSubscribedPosts,
  getSearchedPosts,
  getPostAndComments,
  createNewPost,
  updatePost,
  deletePost,
};
