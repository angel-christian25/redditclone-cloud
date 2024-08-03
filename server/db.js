const mongoose = require('mongoose');
const { MONGODB_URI: url } = require('./utils/config');

const connectToDB = async () => {
  try {
    // Log connection attempt
    console.log('Attempting to connect to MongoDB...');

    // Connect to MongoDB with TLS disabled
    await mongoose.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // No need for sslCA or any other TLS-related options
    });

    // Log successful connection
    console.log('Connected to MongoDB!');
  } catch (error) {
    // Log connection error
    console.error('Error while connecting to MongoDB:', error.message);
  }
};

module.exports = connectToDB;
