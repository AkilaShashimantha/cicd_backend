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
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000', 'https://cicd-frontend-alpha.vercel.app'],
};

// =============================================
// MIDDLEWARE
// =============================================
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Enhanced CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || config.ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Logging
if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// =============================================
// DATABASE CONNECTION
// =============================================
mongoose.connect(config.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
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

const Image = mongoose.model('Image', imageSchema);

// =============================================
// FILE UPLOAD CONFIGURATION
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
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images are allowed (JPEG, PNG, GIF, WEBP)'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter
});

// =============================================
// ROUTES
// =============================================

/**
 * @route POST /api/upload
 * @desc Upload an image
 */
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No file uploaded or invalid file type' 
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
    
    // Construct proper URL
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${savedImage.filename}`;

    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        id: savedImage._id,
        name: savedImage.originalname,
        url: imageUrl,
        size: savedImage.size,
        uploadedAt: savedImage.createdAt
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Server error during upload',
      details: config.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * @route GET /api/images
 * @desc Get all uploaded images
 */
app.get('/api/images', async (req, res) => {
  try {
    const images = await Image.find().sort({ createdAt: -1 });
    
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
      images: response
    });
  } catch (err) {
    console.error('Error fetching images:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch images',
      details: config.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// =============================================
// STATIC FILES AND ERROR HANDLING
// =============================================

// Serve uploaded files statically
app.use('/uploads', express.static(config.UPLOAD_DIR));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    environment: config.NODE_ENV
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
  console.error('Server error:', err.stack);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ 
      success: false,
      error: err.message || 'File upload error'
    });
  }

  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    details: config.NODE_ENV === 'development' ? err.message : undefined
  });
});

// =============================================
// SERVER STARTUP
// =============================================
const server = app.listen(config.PORT, () => {
  console.log(`🚀 Server running in ${config.NODE_ENV} mode on port ${config.PORT}`);
  console.log(`📁 Upload directory: ${config.UPLOAD_DIR}`);
  console.log(`🌍 Allowed origins: ${config.ALLOWED_ORIGINS.join(', ')}`);
  console.log(`🔗 Health check: http://localhost:${config.PORT}/api/health`);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

module.exports = server;