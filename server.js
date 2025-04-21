require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const app = express();

// =============================================
// CONFIGURATION
// =============================================
const config = {
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://akilashashimantha84:75yT5kSc38aAtsVS@cluster0.g7rrc6i.mongodb.net/Image_upload?retryWrites=true&w=majority&appName=Cluster0',
  PORT: process.env.PORT || 3001,
  UPLOAD_DIR: path.join(__dirname, 'uploads'),
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  NODE_ENV: process.env.NODE_ENV || 'development',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
  API_RATE_LIMIT_WINDOW: process.env.API_RATE_LIMIT_WINDOW || 15 * 60 * 1000, // 15 minutes
  API_RATE_LIMIT_MAX: process.env.API_RATE_LIMIT_MAX || 100
};

// =============================================
// SECURITY MIDDLEWARE
// =============================================
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.API_RATE_LIMIT_WINDOW,
  max: config.API_RATE_LIMIT_MAX,
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', limiter);

// CORS Configuration
app.use(cors({
  origin: config.ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Logging
if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// =============================================
// MONGODB CONNECTION
// =============================================
mongoose.connect(config.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
})
.then(() => console.log('✅ MongoDB connected successfully to Image_upload database'))
.catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  process.exit(1);
});

// =============================================
// DATABASE SCHEMA
// =============================================
const imageSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalname: { type: String, required: true },
  path: { type: String, required: true },
  size: { type: Number, required: true },
  mimetype: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Image = mongoose.model('Image', imageSchema, 'images');

// =============================================
// FILE UPLOAD CONFIG
// =============================================
if (!fs.existsSync(config.UPLOAD_DIR)) {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  console.log(`📁 Created upload directory: ${config.UPLOAD_DIR}`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `img-${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, GIF, or WEBP images are allowed'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter
});

// =============================================
// API ENDPOINTS
// =============================================

/**
 * @route POST /api/upload
 * @desc Upload an image
 * @access Public
 */
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No file uploaded or file type not allowed' 
      });
    }

    const newImage = new Image({
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    const savedImage = await newImage.save();
    
    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        id: savedImage._id,
        name: savedImage.originalname,
        url: `${req.protocol}://${req.get('host')}/uploads/${savedImage.filename}`,
        size: savedImage.size,
        uploadedAt: savedImage.createdAt
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Server error during upload' 
    });
  }
});

/**
 * @route GET /api/images
 * @desc Get all uploaded images
 * @access Public
 */
app.get('/api/images', async (req, res) => {
  try {
    const images = await Image.find().sort({ createdAt: -1 }).lean();
    
    const response = images.map(img => ({
      id: img._id,
      name: img.originalname,
      url: `${req.protocol}://${req.get('host')}/uploads/${img.filename}`,
      size: img.size,
      uploadedAt: img.createdAt
    }));

    res.json({ 
      success: true,
      count: response.length,
      data: response
    });
  } catch (err) {
    console.error('Error fetching images:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch images' 
    });
  }
});

// =============================================
// STATIC FILES AND SERVER START
// =============================================
app.use('/uploads', express.static(config.UPLOAD_DIR));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ 
      success: false,
      error: err.message 
    });
  }

  res.status(500).json({ 
    success: false,
    error: 'Internal server error' 
  });
});

// Server startup
const server = app.listen(config.PORT, () => {
  console.log(`🚀 Server running in ${config.NODE_ENV} mode on port ${config.PORT}`);
  console.log(`📂 Uploads directory: ${config.UPLOAD_DIR}`);
  console.log(`🌍 Allowed origins: ${config.ALLOWED_ORIGINS.join(', ')}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});

module.exports = server;