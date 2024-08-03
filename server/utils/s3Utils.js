// utils/s3Utils.js
export const getS3Avatar = (imagePath) => {
    const bucketUrl = 'https://your-s3-bucket-url.com/';
    return `${bucketUrl}${imagePath}`;
  };
  