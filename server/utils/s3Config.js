// utils/s3Config.js
const AWS = require('aws-sdk');

// Configure AWS SDK with access key, secret access key, session token, and region
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   sessionToken: process.env.AWS_SESSION_TOKEN, // Include session token
  region: process.env.AWS_REGION // e.g., 'us-east-1'
});

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.AWS_BUCKET_NAME; // Use environment variable for bucket name

module.exports = { s3, BUCKET_NAME };
