require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const { log } = require('console');
const mailer = require('nodemailer');
const app = express();
const port = process.env.PORT || 5000;
const fs = require('fs');
// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the "public" directory
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './public/uploads');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Connect to MongoDB
// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/RegionHub';
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schemas and Models
const categorySchema = new mongoose.Schema({
  category_name: {
    type: String,
    required: true,
    unique: true
  }
});
app.post('/user/complaint', async (req, res) => {
  try {
    const { user_id, cart_id, title, content } = req.body;

    // Detailed validation
    const errors = {};
    if (!user_id) errors.user_id = "User ID is required";
    if (!cart_id) errors.cart_id = "Cart ID is required";
    if (!title) errors.title = "Title is required";
    if (!content) errors.content = "Content is required";
    
    // Additional content validation
    if (content && content.length < 20) {
      errors.content = "Content must be at least 20 characters";
    }

    // Additional title validation
    if (title && title.length > 100) {
      errors.title = "Title must be 100 characters or less";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ 
        success: false,
        message: "Validation failed",
        errors
      });
    }

    // Create complaint with default values
    const complaint = new Complaint({
      complaint_id: new mongoose.Types.ObjectId(),
      title: title.trim(),
      content: content.trim(),
      cart_id,
      user_id,
      status: "pending",
      reply: null
    });

    await complaint.save();

    // Return response with all schema fields
    res.status(201).json({
      success: true,
      message: "Complaint submitted successfully",
      data: {
        complaint_id: complaint._id,
        title: complaint.title,
        content: complaint.content,
        status: complaint.status,
        cart_id: complaint.cart_id,
        user_id: complaint.user_id,
        reply: complaint.reply,
        createdAt: complaint.createdAt,
        updatedAt: complaint.updatedAt
      }
    });

  } catch (error) {
    console.error('Error submitting complaint:', error);
    
    // Handle duplicate complaints
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate complaint detected"
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
app.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-__v -user_password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Update user details (excluding photo)
app.put('/user/:id', async (req, res) => {
  try {
    const { user_name, user_email, user_password, address } = req.body;
    
    const updateFields = {};
    if (user_name) updateFields.user_name = user_name;
    if (user_email) updateFields.user_email = user_email;
    if (user_password) updateFields.user_password = user_password;
    if (address) {
      // Handle address update - you might want separate address endpoints
      updateFields.address = address;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true }
    ).select('-__v -user_password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user });
  } catch (err) {
    console.error('Error updating user:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Update or remove profile picture
app.put('/user/:id/photo', upload.single('user_photo'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // If there was a previous photo, delete it
    if (user.user_photo && req.file) {
      const oldPhotoPath = path.join(__dirname, 'uploads', user.user_photo);
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
    }

    // Update with new photo or set to null if no file provided (removing photo)
    if (req.file) {
      user.user_photo = req.file.filename;
    } else {
      // This handles the case where you want to remove the photo
      if (user.user_photo) {
        const oldPhotoPath = path.join(__dirname, 'uploads', user.user_photo);
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
      user.user_photo = null;
    }

    await user.save();
    
    res.json({ 
      message: req.file ? 'Profile photo updated' : 'Profile photo removed',
      user_photo: user.user_photo 
    });
  } catch (err) {
    console.error('Error updating profile photo:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Delete user account
app.delete('/user/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete profile photo if exists
    if (user.user_photo) {
      const photoPath = path.join(__dirname, 'uploads', user.user_photo);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// Get complaints with product details for a user
app.get('/user/complaints/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }

    const complaints = await Complaint.aggregate([
      { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
      {
        $lookup: {
          from: 'carts',
          localField: 'cart_id',
          foreignField: '_id',
          as: 'cart'
        }
      },
      { $unwind: '$cart' },  // Unwind to extract single cart object
      {
        $lookup: {
          from: 'products',
          localField: 'cart.product_id', // Use product_id from the cart
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },  // Unwind to extract single product object
      {
        $lookup: {
          from: 'galleries',
          localField: 'product._id',  // Fetch gallery based on product _id
          foreignField: 'product_id', // Match with gallery's product_id
          as: 'gallery_images'
        }
      },
      {
        $addFields: {
          first_image: {
            $arrayElemAt: ['$gallery_images.gallery_photo', 0] // Fetch first image
          }
        }
      },
      {
        $project: {
          _id: 1,
          title: 1,
          content: 1,
          reply: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          product: {
            name: 1,
            price: 1,
            description: 1
          },
          purchase: {
            date: '$cart.createdAt',
            quantity: '$cart.qty'
          },
          gallery_image: '$first_image',  // Show only the first image
          total: '$cart.cart_price'
        }
      },
      { $sort: { createdAt: -1 } }
    ]);
    
    
    res.status(200).json({
      success: true,
      data: complaints
    });

  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});
app.get("/admin/top-vendor/yearly", async (req, res) => {
  try {
    const year = parseInt(req.query.v) || new Date().getFullYear();

    const start = new Date(`${year}-01-01`);
    const end = new Date(`${year + 1}-01-01`);

    const carts = await Cart.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "orders",
          localField: "order_id",
          foreignField: "_id",
          as: "order",
        },
      },
      { $unwind: "$order" },
      {
        $match: {
          "order.date": { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: "$product.vendor_id",
          totalRevenue: { $sum: "$cart_price" },
          products: {
            $push: {
              name: "$product.name",
              qty: "$qty",
              price: "$cart_price",
              product_id: "$product._id"
            },
          },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 1 },
    ]);

    if (carts.length === 0) {
      return res.status(404).json({ message: "No vendor data found for the year" });
    }

    const topVendorId = carts[0]._id;
    const vendorDetails = await Vendor.findById(topVendorId).select("vendor_name vendor_address vendor_lat vendor_lon");

    // Find most sold product by qty
    const mostSold = carts[0].products.reduce((top, current) =>
      current.qty > (top.qty || 0) ? current : top, {}
    );

    res.status(200).json({
      vendor: vendorDetails,
      mostSoldProduct: mostSold,
      totalRevenue: carts[0].totalRevenue,
    });

  } catch (error) {
    console.error("Error fetching top vendor:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Get all complaints (admin)
app.get("/admin/top-product", async (req, res) => {
  try {
    const { from, to } = req.query;

    const startDate = new Date(from);
    const endDate = new Date(to);

    const result = await Cart.aggregate([
      {
        $lookup: {
          from: "orders",
          localField: "order_id",
          foreignField: "_id",
          as: "order"
        }
      },
      { $unwind: "$order" },
      {
        $match: {
          "order.date": { $gte: startDate, $lte: endDate },
          status: "processing"
        }
      },
      {
        $lookup: {
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "vendors",
          localField: "product.vendor_id",
          foreignField: "_id",
          as: "vendor"
        }
      },
      { $unwind: "$vendor" },
      {
        $group: {
          _id: {
            productId: "$product._id",
            productName: "$product.name",
            productPrice: "$product.price",
            vendorId: "$vendor._id",
            vendorName: "$vendor.vendor_name",
            vendorAddress: "$vendor.vendor_address",
            vendorLat: "$vendor.vendor_lat",
            vendorLon: "$vendor.vendor_lon"
          },
          totalQty: { $sum: "$qty" },
          totalRevenue: { $sum: "$cart_price" }
        }
      },
      { $sort: { totalQty: -1 } },
      { $limit: 1 }
    ]);

    res.json(result[0] || {});
  } catch (error) {
    console.error("Error fetching top product:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});

app.get('/admin/complaints', async (req, res) => {
  try {
    const complaints = await Complaint.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $lookup: {
          from: 'carts',
          localField: 'cart_id',
          foreignField: '_id',
          as: 'cart'
        }
      },
      { $unwind: '$cart' },
      {
        $lookup: {
          from: 'products',
          localField: 'cart.product_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 1,
          title: 1,
          content: 1,
          reply: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          user_id: 1,
          'user.name': 1,
          'user.email': 1,
          'product.name': 1,
          'product.price': 1,
          'cart.quantity': 1,
          gallery_image: '$product.gallery_image'
        }
      },
      { $sort: { createdAt: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: complaints
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Submit reply to complaint
app.post('/admin/complaints/:complaintId/reply', async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { reply, status } = req.body;

    if (!reply || !status) {
      return res.status(400).json({
        success: false,
        message: 'Reply and status are required'
      });
    }

    const updatedComplaint = await Complaint.findByIdAndUpdate(
      complaintId,
      {
        reply,
        status,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!updatedComplaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    res.status(200).json({
      success: true,
      data: updatedComplaint
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});
app.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-user_password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      user_name: user.user_name,
      user_email: user.user_email,
      user_photo: user.user_photo,
      _id: user._id
    });
    
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
const Category = mongoose.model('Category', categorySchema);

const vendorSchema = new mongoose.Schema({
  vendor_name: {
    type: String,
    required: true
  },
  vendor_email: {
    type: String,
    required: true,
    unique: true
  },
  vendor_password: {
    type: String,
    required: true
  },
  vendor_address: {
    type: String,
    required: true
  },
  vendor_pincode: {
    type: String,
    required: true
  },
  vendor_status: {
    type: String,
    default: "requested"
  },
  vendor_photo: {
    type: String,
    required: true
  },
  vendor_proof: {
    type: String,
    required: true
  },
  vendor_lat: {
    type: Number,
    required: true
  },
  vendor_lon: {
    type: Number,
    required: true
  }
});
// Get vendor profile
app.get('/vendor/profile/:id', async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).select('-__v -vendor_password');
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    res.json({ success: true, data: vendor });
  } catch (err) {
    console.error('Error fetching vendor:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Update vendor details
app.put('/vendor/profile/:id', async (req, res) => {
  try {
    const { vendor_password, vendor_address, vendor_lat, vendor_lon } = req.body;
    
    // Validate coordinates
    if (vendor_lat && isNaN(vendor_lat)) {
      return res.status(400).json({ success: false, message: 'Latitude must be a number' });
    }
    if (vendor_lon && isNaN(vendor_lon)) {
      return res.status(400).json({ success: false, message: 'Longitude must be a number' });
    }

    const updateData = {};
    if (vendor_password) updateData.vendor_password = vendor_password;
    if (vendor_address) updateData.vendor_address = vendor_address;
    if (vendor_lat) updateData.vendor_lat = vendor_lat;
    if (vendor_lon) updateData.vendor_lon = vendor_lon;

    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-__v -vendor_password');

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    res.json({ success: true, message: 'Profile updated successfully', data: vendor });
  } catch (err) {
    console.error('Error updating vendor:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});
app.get('/admin/vendors-report', async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ message: 'Both from and to dates are required' });
  }

  try {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999); // Include the entire 'to' date

    // Aggregate to calculate total earnings per vendor and their sold products
    const vendorEarnings = await Cart.aggregate([
      // Match carts with orders in the specified date range
      {
        $lookup: {
          from: 'orders',
          localField: 'order_id',
          foreignField: '_id',
          as: 'orderDetails'
        }
      },
      { $unwind: '$orderDetails' },
      {
        $match: {
          'orderDetails.date': { $gte: fromDate, $lte: toDate },
          status: 'processing'
        }
      },
      // Lookup product details
      {
        $lookup: {
          from: 'products',
          localField: 'product_id',
          foreignField: '_id',
          as: 'productDetails'
        }
      },
      { $unwind: '$productDetails' },
      // Group by vendor to calculate total earnings and collect sold products
      {
        $group: {
          _id: '$productDetails.vendor_id',
          totalEarnings: { $sum: '$cart_price' },
          productsSold: {
            $push: {
              productId: '$productDetails._id',
              name: '$productDetails.name',
              price: '$productDetails.price',
              quantity: '$qty',
              total: '$cart_price'
            }
          }
        }
      },
      // Sort vendors by total earnings in descending order
      { $sort: { totalEarnings: -1 } },
      // Lookup vendor details
      {
        $lookup: {
          from: 'vendors',
          localField: '_id',
          foreignField: '_id',
          as: 'vendorDetails'
        }
      },
      { $unwind: '$vendorDetails' },
      // Project the required fields
      {
        $project: {
          vendorId: '$_id',
          vendorName: '$vendorDetails.vendor_name',
          vendorAddress: '$vendorDetails.vendor_address',
          vendorLat: '$vendorDetails.vendor_lat',
          vendorLon: '$vendorDetails.vendor_lon',
          totalEarnings: 1,
          productsSold: 1
        }
      }
    ]);

    res.json(vendorEarnings);
  } catch (error) {
    console.error('Error fetching vendor earnings report:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
app.get("/admin/vendors", async (req, res) => {
  try {
    const vendors = await Vendor.find();
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ message: "Error fetching vendors", error });
  }
});

const Vendor = mongoose.model('Vendor', vendorSchema);

const reviewSchema = new mongoose.Schema({
  review_id: {
    type: mongoose.Schema.Types.ObjectId,
    auto: true, // Auto-generate ObjectId for each review
  },
  count: {
    type: Number,
    required: true, // Number of stars or rating count
    min: 1,
    max: 5, // Assuming a 1-5 rating system
  },
  content: {
    type: String,
    required: true, // Review content/message
  },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product", // Reference to the Product collection
    required: true,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Reference to the User collection
    required: true,
  },
}, { timestamps: true }); // Auto-add createdAt and updatedAt fields

const Review = mongoose.model("Review", reviewSchema);



const complaintSchema = new mongoose.Schema(
  {
    complaint_id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true, // Auto-generate ObjectId
    },
    title: {
      type: String,
      required: true, // Title of the complaint
      trim: true,
    },
    content: {
      type: String,
      required: true, // Complaint content/message
    },
    reply: {
      type: String, // Admin/Vendor response to the complaint
      default: null, // Default is null until replied
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "rejected"], // Complaint status
      default: "pending",
    },
    cart_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cart", // Reference to the Vendor collection
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Reference to the User collection
      required: true,
    },
  },
  { timestamps: true } // Auto-add createdAt and updatedAt fields
);

const Complaint = mongoose.model("Complaint", complaintSchema);




const adminSchema = new mongoose.Schema({
  _id: {
    type: mongoose.Schema.Types.ObjectId,
    default: mongoose.Types.ObjectId, // Automatically generate an ObjectId if not provided
  },
  name: {
    type: String,
    required: true,
    trim: true, // Removes extra spaces
  },
  email: {
    type: String,
    required: true,
    unique: true, // Ensures no duplicate emails
    trim: true,
    lowercase: true, // Converts email to lowercase
  },
  password: {
    type: String,
    required: true,
  },
});

const Admin = mongoose.model("Admin", adminSchema);
app.get('/vendor/:vendorId/product/:productId/stock-left', async (req, res) => {
  try {
    const { vendorId, productId } = req.params;

    // Step 1: Confirm the product exists and belongs to the vendor
    const product = await Product.findOne({ _id: productId, vendor_id: vendorId });
    if (!product) {
      return res.status(404).json({ message: 'Product not found for this vendor' });
    }

    // Step 2: Calculate total stock added for the product
    const totalStockData = await Stock.aggregate([
      {
        $match: {
          product_id: new mongoose.Types.ObjectId(productId)
        }
      },
      {
        $group: {
          _id: "$product_id",
          totalStock: { $sum: "$stock_quantity" }
        }
      }
    ]);

    const totalStock = totalStockData.length > 0 ? totalStockData[0].totalStock : 0;

    // Step 3: Calculate total quantity sold from carts with order status >= '2'
    const soldQuantityData = await Cart.aggregate([
      {
        $lookup: {
          from: 'orders',
          localField: 'order_id',
          foreignField: '_id',
          as: 'order'
        }
      },
      { $unwind: "$order" },
      {
        $match: {
          product_id: new mongoose.Types.ObjectId(productId),
          "order.status": { $in: ['2', '3', '4', '5'] } // change to numbers if needed
        }
      },
      {
        $group: {
          _id: "$product_id",
          soldQty: { $sum: "$qty" }
        }
      }
    ]);

    const soldQty = soldQuantityData.length > 0 ? soldQuantityData[0].soldQty : 0;

    // Step 4: Calculate stock left
    const stockLeft = totalStock - soldQty;

    // Response
    return res.json({
      product_id: productId,
      vendor_id: vendorId,
      totalStock,
      soldQty,
      stockLeft
    });

  } catch (error) {
    console.error('Error getting stock left:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


const stockSchema = new mongoose.Schema({
  stock_quantity: {
    type: Number,
    required: true
  },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  stock_date: {
    type: Date,
    required: true
  }
});
app.post('/update-stock/:productId', async (req, res) => {
  try {
    const { quantity } = req.body;
    const newStock = new Stock({
      product_id: req.params.productId,
      stock_quantity: quantity,
      stock_date: new Date()
    });
    await newStock.save();
    res.json({ message: 'Stock updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.get('/stock-history/:productId', async (req, res) => {
  try {
    const history = await Stock.find({ product_id: req.params.productId })
      .sort({ stock_date: -1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
const Stock = mongoose.model('Stock', stockSchema);

const userSchema = new mongoose.Schema({
  user_name: {
    type: String,
    required: true
  },
  user_email: {
    type: String,
    required: true,
    unique: true
  },
  user_password: {
    type: String,
    required: true
  },
  user_photo: {
    type: String,
    default: null
  }
});

app.get("/users/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ✅ **Update user profile (except email)**
app.get("/users/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      user_name: user.user_name,
      user_email: user.user_email,
      user_photo: user.user_photo // Send profile pic
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

const User = mongoose.model('User', userSchema);

app.post("/category", async (req, res) => {
  try {
    const { category_name } = req.body;

    // Check if the category already exists
    let category = await Category.findOne({ category_name });
    if (category) {
      return res.json({ message: "Category already exists" });
    }

    // Create a new category
    category = new Category({
      category_name
    });

    await category.save();
    res.json({ message: "Category added successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
var transporter = mailer.createTransport({
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
  },
});

function sendEmail(to, content) {
  const mailOptions = {
      from: process.env.EMAIL_USER, // Your email ID
      to,
      subject: "Verification",
      html: content,
  };
  
  transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
          console.log(error);
      } else {
          console.log("Email Confirmation sent");
      }
  });
}

app.post("/user-login", async (req, res) => {
  try {
    const { user_email, user_password } = req.body;
    const user = await User.findOne({ user_email });

    if (user && user.user_password === user_password) {
      res.send({
        id: user._id, // Return _id instead of user_id
        login: "User",
      });
    } else {
      res.send({
        login: "error",
      });
    }
  } catch (err) {
    console.error("Error during login:", err.message);
    res.status(500).send("Server error");
  }
});
// Routes for User Operations
// app.post("/user", upload.single('user_photo'), async (req, res) => {
//   try {
//     const { user_name, user_email, user_password } = req.body;

//     if (!req.file) {
//       return res.status(400).json({ message: "Profile photo is required." });
//     }

//     const user_photo = req.file.filename;

//     let user = await User.findOne({ user_email });
//     if (user) {
//       return res.status(400).json({ message: "User already exists." });
//     }

//     user = new User({
//       user_name,
//       user_email,
//       user_password,
//       user_photo,
//     });

//     await user.save();
//     res.status(201).json({ message: "User created successfully.", id: user._id });
//   } catch (err) {
//     console.error("Error creating user:", err.message);
//     res.status(500).json({ message: "Server error", error: err.message });
//   }
// });


// app.post("/user", upload.single("user_photo"), async (req, res) => {
//   try {
//     const { user_name, user_email, user_password } = req.body;

//     if (!req.file) {
//       return res.status(400).json({ message: "Profile photo is required." });
//     }

//     const user_photo = req.file.filename;

//     // Check if the user already exists
//     let user = await User.findOne({ user_email });
//     if (user) {
//       return res.status(400).json({ message: "User already exists." });
//     }

//     // Create a new user
//     user = new User({
//       user_name,
//       user_email,
//       user_password,
//       user_photo,
//     });

//     await user.save();

//     // Email Content
//     let content = `
//     <html>
//     <head>
//         <title>Welcome to RegionHub</title>
//         <style>
//             .container {
//                 width: 90%;
//                 max-width: 600px;
//                 margin: 0 auto;
//                 padding: 20px;
//                 background-color: #f2f2f2;
//                 font-family: Arial, sans-serif;
//             }
//             .welcome-box {
//                 width: 90%;
//                 max-width: 600px;
//                 background-color: #ffffff;
//                 padding: 20px;
//                 border-radius: 8px;
//                 text-align: center;
//                 box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
//             }
//             .welcome-text {
//                 font-size: 24px;
//                 font-weight: bold;
//                 color: #333333;
//                 margin-bottom: 10px;
//             }
//             .welcome-icon {
//                 font-size: 48px;
//                 color: #28a745;
//                 margin-top: 10px;
//             }
//             .instructions {
//                 font-size: 16px;
//                 color: #555555;
//                 margin-top: 15px;
//                 line-height: 1.5;
//             }
//             .login-button {
//                 display: inline-block;
//                 padding: 12px 25px;
//                 margin-top: 20px;
//                 font-size: 16px;
//                 font-weight: bold;
//                 color: #ffffff;
//                 background-color: #007bff;
//                 text-decoration: none;
//                 border-radius: 5px;
//                 transition: 0.3s ease;
//             }
//             .login-button:hover {
//                 background-color: #0056b3;
//             }
//         </style>
//     </head>
//     <body>
//         <div class="container">
//             <div class="welcome-box">
//                 <div class="welcome-text">Hi ${user_name}, Welcome to RegionHub! 🎉</div>
//                 <div class="welcome-icon">✅</div>
//                 <div class="instructions">
//                     You have successfully created your account on <strong>RegionHub</strong>. Start exploring local products now!<br><br>
//                     <strong>Your User ID:</strong> ${user._id}
//                 </div>
//                 <a href="http://localhost:5173/guest/user-login" class="login-button">Click Here to Login</a>
//             </div>
//         </div>
//     </body>
//     </html>
//     `;

//     // Send email notification
//     sendEmail(user_email, content);

//     res.status(201).json({ message: "User created successfully.", id: user._id });
//   } catch (err) {
//     console.error("Error creating user:", err.message);
//     res.status(500).json({ message: "Server error", error: err.message });
//   }
// });


app.get("/users", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
app.get("/user/profile/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-user_password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
app.post("/user", async (req, res) => {
  try {
    const { user_name, user_email, user_password } = req.body;

    let user = await User.findOne({ user_email });
    if (user) {
      return res.status(400).json({ message: "User already exists." });
    }

    const newUser = new User({
      user_name,
      user_email,
      user_password,
    });

    await newUser.save();
    res.status(201).json({ message: "User created successfully.", id: newUser._id });
  } catch (err) {
    console.error("Error creating user:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


app.delete("/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    await user.deleteOne();
    res.json({ message: "User removed successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Vendor Routes
app.post("/vendor-request", upload.fields([{ name: 'vendor_photo' }, { name: 'vendor_proof' }]), async (req, res) => {
  try {
    const { vendor_name, vendor_email, vendor_password, vendor_address, vendor_pincode, vendor_lat, vendor_lon } = req.body;
    const vendor_photo = req.files.vendor_photo[0].filename;
    const vendor_proof = req.files.vendor_proof[0].filename;

    let vendor = await Vendor.findOne({ vendor_email });
    if (vendor) {
      return res.json({ message: "Vendor already exists" });
    }
    vendor = new Vendor({
      vendor_name,
      vendor_email,
      vendor_password,
      vendor_address,
      vendor_pincode,
      vendor_status: "requested",
      vendor_photo,
      vendor_proof,
      vendor_lat,
      vendor_lon
    });
    await vendor.save();
    res.json({ message: "Vendor request submitted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
// Add this route for vendor updates
app.put("/vendor-update/:id", upload.fields([{ name: 'vendor_photo' }, { name: 'vendor_proof' }]), async (req, res) => {
  try {
    const { vendor_address, vendor_pincode, vendor_lat, vendor_lon, vendor_password } = req.body;
    const vendorId = req.params.id;

    // Find the vendor
    let vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // Prepare update object with only the fields that were provided
    const updateFields = {};
    
    if (vendor_address) updateFields.vendor_address = vendor_address;
    if (vendor_pincode) updateFields.vendor_pincode = vendor_pincode;
    if (vendor_lat) updateFields.vendor_lat = vendor_lat;
    if (vendor_lon) updateFields.vendor_lon = vendor_lon;
    
    // Handle password update separately (hash it)
    if (vendor_password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.vendor_password = await bcrypt.hash(vendor_password, salt);
    }

    // Handle file uploads if they exist
    if (req.files?.vendor_photo) {
      updateFields.vendor_photo = req.files.vendor_photo[0].filename;
      // Optionally: Delete old photo file from server
    }
    if (req.files?.vendor_proof) {
      updateFields.vendor_proof = req.files.vendor_proof[0].filename;
      // Optionally: Delete old proof file from server
    }

    // Update the vendor
    vendor = await Vendor.findByIdAndUpdate(
      vendorId,
      { $set: updateFields },
      { new: true }
    );

    res.json({ 
      message: "Vendor updated successfully",
      vendor: {
        id: vendor._id,
        name: vendor.vendor_name,
        email: vendor.vendor_email,
        address: vendor.vendor_address,
        pincode: vendor.vendor_pincode,
        status: vendor.vendor_status
      }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
app.get('/api/vendors/:vendorId', async (req, res) => {
  const { vendorId } = req.params;

  try {
    const vendor = await Vendor.findById(vendorId);
    
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.json(vendor);
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

const userCoordinatesSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  latitude: {
    type: Number,  // Stores decimal values
    required: true
  },
  longitude: {
    type: Number,  // Stores decimal values
    required: true
  }
});

const UserCoordinates = mongoose.model('UserCoordinates', userCoordinatesSchema);


app.post("/api/save-coordinates", async (req, res) => {
  try {
    const { user_id, latitude, longitude } = req.body;

    if (!mongoose.Types.ObjectId.isValid(user_id)) {
      return res.status(400).json({ message: "Invalid user ID." });
    }

    const user = await User.findById(user_id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const userCoordinates = new UserCoordinates({
      user_id,
      latitude,
      longitude,
    });

    await userCoordinates.save();
    res.json({ message: "User coordinates added successfully" });
  } catch (err) {
    console.error("Error saving coordinates:", err.message);
    res.status(500).send("Server error");
  }
});
app.get("/vendor-requests", async (req, res) => {
  try {
    const vendors = await Vendor.find({ vendor_status: "requested" });
    res.json(vendors);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.get("/accepted-vendors", async (req, res) => {
  try {
    const vendors = await Vendor.find({ vendor_status: "accepted" });
    res.json(vendors);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
app.get("/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.status(200).json({ user }); // ✅ IMPORTANT: wraps user in `user`
  } catch (err) {
    console.error("Error fetching user:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.put("/user/:id/photo", upload.single("user_photo"), async (req, res) => {
  try {
    const userId = req.params.id;

    if (!req.file) {
      return res.status(400).json({ message: "New profile photo is required." });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { user_photo: req.file.filename },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({ message: "Profile photo updated successfully.", user: updatedUser });
  } catch (err) {
    console.error("Error updating photo:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.put("/user/:id/photo/delete", async (req, res) => {
  try {
    const userId = req.params.id;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { user_photo: "" },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({ message: "Profile photo deleted.", user: updatedUser });
  } catch (err) {
    console.error("Error deleting photo:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.put("/user/:id/name", async (req, res) => {
  try {
    const userId = req.params.id;
    const { user_name } = req.body;

    if (!user_name) {
      return res.status(400).json({ message: "New name is required." });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { user_name },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found." });
    }

    res.status(200).json({ message: "User name updated successfully.", user: updatedUser });
  } catch (err) {
    console.error("Error updating name:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.post("/login", async (req, res) => {
  const { emailOrName, password } = req.body;

  try {
    const user = await User.findOne({ user_email: emailOrName });
    if (user && user.user_password === password)
      return res.send({ login: "User", id: user._id });

    const admin = await Admin.findOne({ email: emailOrName });
    if (admin && admin.password === password)
      return res.send({ login: "Admin", id: admin._id });

    const vendor = await Vendor.findOne({ vendor_name: emailOrName });
    if (vendor && vendor.vendor_password === password)
      return res.send({ login: "Vendor", id: vendor._id });

    const delivery = await DeliveryPerson.findOne({ email: emailOrName });
    if (delivery && delivery.password === password)
      return res.send({ login: "Delivery", id: delivery._id });

    res.send({ login: "error" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.put("/vendor-accept/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // Update vendor status
    vendor.vendor_status = "accepted";
    await vendor.save();

    // Email content
    let content = `
    <html>
    <head>
        <title>Vendor Request Accepted</title>
        <style>
            .container {
                width: 90%;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f2f2f2;
                font-family: Arial, sans-serif;
            }
            .otp-box {
                width: 90%;
                max-width: 600px;
                background-color: #ffffff;
                padding: 20px;
                border-radius: 8px;
                text-align: center;
                box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
            }
            .otp-text {
                font-size: 24px;
                font-weight: bold;
                color: #333333;
                margin-bottom: 10px;
            }
            .otp-number {
                font-size: 48px;
                font-weight: bold;
                color: #28a745;
                margin-top: 10px;
            }
            .instructions {
                font-size: 16px;
                color: #555555;
                margin-top: 15px;
                line-height: 1.5;
            }
            .login-button {
                display: inline-block;
                padding: 12px 25px;
                margin-top: 20px;
                font-size: 16px;
                font-weight: bold;
                color: #ffffff;
                background-color: #007bff;
                text-decoration: none;
                border-radius: 5px;
                transition: 0.3s ease;
            }
            .login-button:hover {
                background-color: #0056b3;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="otp-box">
                <div class="otp-text">Hi ${vendor.name}, Welcome to RegionHub! 🎉</div>
                <div class="otp-number">✅</div>
                <div class="instructions">
                    Your vendor request has been <strong>approved</strong>! You can now start selling on <strong>RegionHub</strong>.<br><br>
                    <strong>Your Vendor ID:</strong> ${vendor._id}
                </div>
                <a href="http://localhost:5173/guest/vendor-login" class="login-button">Click Here to Login</a>
            </div>
        </div>
    </body>
    </html>
    `;

    // Send email notification
    sendEmail(vendor.email, content);

    res.json({ message: "Vendor request accepted successfully" });
  } catch (err) {
    console.error("Error accepting vendor request:", err);
    res.status(500).send("Server error");
  }
});

// Other imports and configurations...

const addressSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  }
});
// Get user profile
app.get('/user/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-user_password -__v');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile
app.put('/user/:userId', async (req, res) => {
  try {
    const { user_name, user_photo } = req.body;
    
    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      { user_name, user_photo },
      { new: true, runValidators: true }
    ).select('-user_password -__v');
    
    res.json(updatedUser);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get user addresses
app.get('/user/:userId/addresses', async (req, res) => {
  try {
    const addresses = await Address.find({ user_id: req.params.userId });
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new address
app.post('/user/addresses', async (req, res) => {
  try {
    const { content } = req.body;
    const userId = req.user._id; // From authentication middleware
    
    const newAddress = new Address({
      user_id: userId,
      content
    });
    
    await newAddress.save();
    res.status(201).json(newAddress);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update address
app.put('/user/addresses/:addressId', async (req, res) => {
  try {
    const { content } = req.body;
    
    const updatedAddress = await Address.findByIdAndUpdate(
      req.params.addressId,
      { content },
      { new: true }
    );
    
    res.json(updatedAddress);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete address
app.delete('/user/addresses/:addressId', async (req, res) => {
  try {
    await Address.findByIdAndDelete(req.params.addressId);
    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
app.get("/vendor/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }
    res.json(vendor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.put("/vendor/update/:id", async (req, res) => {
  try {
    const { vendor_lat, vendor_lon, vendor_address } = req.body;
    const updatedVendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      { vendor_lat, vendor_lon, vendor_address },
      { new: true }
    );
    if (!updatedVendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }
    res.json({ message: "Vendor updated successfully", vendor: updatedVendor });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
app.delete("/vendor/delete/:id", async (req, res) => {
  try {
    const deletedVendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!deletedVendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }
    res.json({ message: "Vendor account deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

const Address = mongoose.model('Address', addressSchema);

app.post("/address", async (req, res) => {
  try {
    const { user_id, content } = req.body;

    const address = new Address({
      user_id,
      content
    });

    await address.save();
    res.json({ message: "Address added successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
// Edit an address
app.put("/address/:id", async (req, res) => {
  try {
    const { content } = req.body;
    const updatedAddress = await Address.findByIdAndUpdate(
      req.params.id,
      { content },
      { new: true }
    );
    res.json({ message: "Address updated successfully", address: updatedAddress });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Delete an address
app.delete("/address/:id", async (req, res) => {
  try {
    await Address.findByIdAndDelete(req.params.id);
    res.json({ message: "Address deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.get("/addresses", async (req, res) => {
  try {
    const addresses = await Address.find().populate('user_id');
    res.json(addresses);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Other routes and configurations...




app.delete("/vendor-remove/:id", async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }
    await Vendor.deleteOne({ _id: req.params.id });
    res.json({ message: "Vendor removed successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Product Routes
app.post("/products", async (req, res) => {
  try {
    const { name, description, details, offer, price, category_id, vendor_id } = req.body;

    const product = new Product({
      name,
      description,
      details,
      offer,
      price,
      category_id,
      vendor_id
    });

    await product.save();
    res.json({ message: "Product added successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.get("/categories", async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.post("/gallery", upload.fields([{ name: 'gallery_photo' }]), (req, res) => {
  console.log('Received data:', req.body);
  console.log('Received files:', req.files);

  const { product_id } = req.body;
  var fileValue = JSON.parse(JSON.stringify(req.files));
  var galleryPhotoSrc = `http://127.0.0.1:${port}/uploads/${fileValue.gallery_photo[0].filename}`;

  // Log the data for debugging
  console.log('Processed data:', { product_id, galleryPhotoSrc });

  const gallery = new Gallery({
    gallery_photo: galleryPhotoSrc,
    product_id
  });

  gallery.save()
    .then(() => {
      res.status(201).send({ message: 'Image uploaded successfully', data: { product_id, galleryPhotoSrc } });
    })
    .catch(err => {
      console.error(err.message);
      res.status(500).send("Server error");
    });
});
app.get("/vendor-details", async (req, res) => {
  try {
    const { vendorId } = req.query;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    res.json(vendor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
app.put("/vendor-update", upload.single("vendor_photo"), async (req, res) => {
  try {
    const { vendorId } = req.query;
    const {
      vendor_address,
      vendor_pincode,
      vendor_lat,
      vendor_lon,
      vendor_password
    } = req.body;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    // Update allowed fields
    vendor.vendor_address = vendor_address;
    vendor.vendor_pincode = vendor_pincode;
    vendor.vendor_lat = vendor_lat;
    vendor.vendor_lon = vendor_lon;

    if (vendor_password) {
      vendor.vendor_password = vendor_password; // No hashing as per your request
    }

    if (req.file) {
      vendor.vendor_photo = req.file.filename;
    }

    await vendor.save();
    res.json({ message: "Vendor updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});
app.get("/products", async (req, res) => {
  try {
    const { vendorId } = req.query;
    if (!vendorId) {
      return res.status(400).send("vendorId is required");
    }
    const products = await Product.find({ vendor_id: vendorId }).populate('category_id').populate('vendor_id');
    res.json(products);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.post("/stocks", async (req, res) => {
  try {
    const { stock_quantity, product_id, stock_date } = req.body;

    const stock = new Stock({
      stock_quantity,
      product_id,
      stock_date
    });

    await stock.save();
    res.json({ message: "Stock added successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Product Details - Vendor
app.get("/product-gallery/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const gallery = await Gallery.find({ product_id: productId });
    res.json(gallery);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.get("/product-details/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId).populate('category_id').populate('vendor_id');
    res.json(product);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});
app.put("/product-details/:productId", async (req, res) => {
  const { productId } = req.params;

  // Check if the ID is valid
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }

  try {
    const updatedProduct = await Product.findByIdAndUpdate(productId, req.body, { new: true });

    if (!updatedProduct) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(updatedProduct);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/product-stock/:stockId", async (req, res) => {
  try {
    const { stockId } = req.params;
    const updatedStock = req.body;
    const stock = await Stock.findByIdAndUpdate(stockId, updatedStock, { new: true });
    res.json(stock);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// Vendor Login Endpoint
app.post("/vendor-login", async (req, res) => {
  try {
    const { vendorname, password } = req.body;
    const vendor = await Vendor.findOne({ vendor_name: vendorname });

    if (vendor && vendor.vendor_password === password) {
      res.send({
        id: vendor._id,
        login: "Vendor",
      });
    } else {
      res.send({
        login: "error",
      });
    }
  } catch (err) {
    console.error("Error", err);
    res.status(500).send("Server error");
  }
});

// Admin Login Endpoint
app.post("/admin-login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });

    if (admin && admin.password === password) {
      res.send({
        id: admin._id,
        login: "Admin",
      });
    } else {
      res.send({
        login: "error",
      });
    }
  } catch (err) {
    console.error("Error", err);
    res.status(500).send("Server error");
  }
});

app.get("/products1", async (req, res) => {
  try {
    const products = await Product.find().populate('category_id').populate('vendor_id').populate('gallery');
    res.json(products);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

app.get("/all-products", async (req, res) => {
  try {
    const products = await Product.find().populate("category_id").populate("vendor_id");

    // Fetch the first image for each product
    const productsWithImages = await Promise.all(
      products.map(async (product) => {
        const galleryImage = await Gallery.findOne({ product_id: product._id });
        return {
          _id: product._id,
          name: product.name,
          price: product.price,
          firstImage: galleryImage ? galleryImage.gallery_photo : null, // First image if available
        };
      })
    );

    res.json(productsWithImages);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = (angle) => (angle * Math.PI) / 180;
  const R = 6371; // Radius of Earth in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
};

app.get("/nearby-products", async (req, res) => {
  try {
    const { latitude, longitude, category } = req.query;

    // Validate latitude and longitude
    if (!latitude || !longitude) {
      return res.status(400).json({ message: "Latitude and longitude are required" });
    }

    // Build the base query
    let query = Product.find();

    // If category is provided, filter by category name
    if (category && category !== "All") {
      const categoryDoc = await Category.findOne({ category_name: category });
      if (categoryDoc) {
        query = query.where("category_id").equals(categoryDoc._id);
      } else {
        // If category doesn't exist, return an empty array
        return res.json([]);
      }
    }

    // Fetch products and populate vendor and category details
    const products = await query.populate("vendor_id").populate("category_id");

    // Fetch the first image for each product and calculate the distance
    const productsWithDetails = await Promise.all(
      products.map(async (product) => {
        const vendor = product.vendor_id;

        // Check if vendor has valid latitude and longitude
        if (!vendor || !vendor.vendor_lat || !vendor.vendor_lon) {
          return null; // Exclude products without valid vendor location
        }

        // Calculate the distance using the Haversine formula
        const distance = haversineDistance(
          parseFloat(latitude),
          parseFloat(longitude),
          vendor.vendor_lat,
          vendor.vendor_lon
        );

        // Fetch the first image from the Gallery collection
        const galleryImage = await Gallery.findOne({ product_id: product._id });

        return {
          ...product.toObject(),
          distance,
          firstImage: galleryImage ? galleryImage.gallery_photo : null,
          category: product.category_id ? product.category_id.category_name : null,
        };
      })
    );

    // Filter out null values (products without valid vendor location)
    const validProducts = productsWithDetails.filter((product) => product !== null);

    // Sort products by distance (nearest first)
    validProducts.sort((a, b) => a.distance - b.distance);

    res.json(validProducts);
  } catch (err) {
    console.error("Error fetching nearby products:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.put(
  "/delivery-person-update",
  upload.fields([{ name: "photo" }]),
  async (req, res) => {
    try {
      const { deliveryPersonId } = req.query;
      const { password } = req.body;
      const updateData = {};

      if (password && password.trim() !== "") {
        updateData.password = password;
      }

      if (req.files?.photo && req.files.photo[0]) {
        updateData.photo = req.files.photo[0].filename;
      }

      const updatedPerson = await DeliveryPerson.findByIdAndUpdate(
        deliveryPersonId,
        updateData,
        { new: true }
      );

      if (!updatedPerson) {
        return res.status(404).json({ message: "Delivery person not found" });
      }

      res.json({ message: "Profile updated successfully", updatedPerson });
    } catch (err) {
      console.error("Error updating delivery person profile:", err);
      res.status(500).send("Server error");
    }
  }
);
app.get("/delivery-person-details", async (req, res) => {
  try {
    const { deliveryPersonId } = req.query;

    const deliveryPerson = await DeliveryPerson.findById(deliveryPersonId);
    if (!deliveryPerson) {
      return res.status(404).json({ message: "Delivery person not found" });
    }

    res.json(deliveryPerson);
  } catch (err) {
    console.error("Error fetching delivery person details:", err);
    res.status(500).send("Server error");
  }
});

app.post("/delivery-person-request", upload.fields([{ name: "a_proof" }, { name: "photo" }]), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const a_proof = req.files.a_proof[0].filename;
    const photo = req.files.photo[0].filename;

    // Check if the delivery person already exists
    const existingPerson = await DeliveryPerson.findOne({ email });
    if (existingPerson) {
      return res.status(400).json({ message: "Delivery person already exists" });
    }

    // Create a new delivery person
    const deliveryPerson = new DeliveryPerson({
      name,
      email,
      password,
      a_proof,
      photo,
      status: "inactive", // Default status
    });

    await deliveryPerson.save();
    res.status(201).json({ message: "Delivery person request submitted successfully" });
  } catch (err) {
    console.error("Error submitting delivery person request:", err);
    res.status(500).send("Server error");
  }
});
app.put("/delivery-person-accept/:id", async (req, res) => {
  try {
    const deliveryPerson = await DeliveryPerson.findById(req.params.id);
    if (!deliveryPerson) {
      return res.status(404).json({ message: "Delivery person not found" });
    }

    // Update status
    deliveryPerson.status = "active";
    await deliveryPerson.save();

    // Email content
    let content = `
    <html>
    <head>
        <title>Delivery Person Accepted</title>
        <style>
            .container {
                width: 90%;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f2f2f2;
                font-family: Arial, sans-serif;
            }
            .otp-box {
                width: 90%;
                max-width: 600px;
                background-color: #ffffff;
                padding: 20px;
                border-radius: 5px;
                text-align: center;
            }
            .otp-text {
                font-size: 24px;
                font-weight: bold;
                color: #333333;
            }
            .otp-number {
                font-size: 48px;
                font-weight: bold;
                color: #007bff;
                margin-top: 10px;
            }
            .instructions {
                font-size: 14px;
                color: #666666;
                margin-top: 10px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="otp-box">
                <div class="otp-text">Hi ${deliveryPerson.name}, Welcome Aboard! 🚀</div>
                <div class="otp-number">✅</div>
                <div class="instructions">
                Your data has been verfied
                   and request has been accepted! You are now an active delivery partner.<br><br>
                    <strong>Your ID:</strong> ${deliveryPerson._id}
                </div>
                                <a href="http://localhost:5173/guest/delivery-login" class="login-button">Click Here to Login</a>

            </div>
        </div>
    </body>
    </html>
    `;

    // Send email notification
    sendEmail(deliveryPerson.email, content);

    res.json({ message: "Delivery person accepted successfully" });
  } catch (err) {
    console.error("Error accepting delivery person request:", err);
    res.status(500).send("Server error");
  }
});


app.get("/delivery-person-requests", async (req, res) => {
  try {
    const requests = await DeliveryPerson.find({ status: "inactive" });
    res.json(requests);
  } catch (err) {
    console.error("Error fetching delivery person requests:", err);
    res.status(500).send("Server error");
  }
});
app.delete("/delivery-person-reject/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Find the delivery person by ID
    const deliveryPerson = await DeliveryPerson.findById(id);
    if (!deliveryPerson) {
      return res.status(404).json({ message: "Delivery person not found" });
    }

    // Delete the delivery person record
    await deliveryPerson.deleteOne();
    res.json({ message: "Delivery person rejected successfully" });
  } catch (err) {
    console.error("Error rejecting delivery person request:", err);
    res.status(500).send("Server error");
  }
});
app.get("/accepted-delivery-persons", async (req, res) => {
  try {
    const deliveryPersons = await DeliveryPerson.find({ status: "active" });
    res.json(deliveryPersons);
  } catch (err) {
    console.error("Error fetching delivery persons:", err);
    res.status(500).send("Server error");
  }
});
app.delete("/delivery-person-remove/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deliveryPerson = await DeliveryPerson.findById(id);
    if (!deliveryPerson) {
      return res.status(404).json({ message: "Delivery person not found" });
    }
    await deliveryPerson.deleteOne();
    res.json({ message: "Delivery person removed successfully" });
  } catch (err) {
    console.error("Error removing delivery person:", err);
    res.status(500).send("Server error");
  }
});

const cartSchema = new mongoose.Schema({
  qty: {
    type: Number,
    required: true,
    min: 1, // Quantity must be at least 1
  },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product', // Reference to the Product collection
    required: true,
  },
  order_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order', // Reference to the Order collection (if applicable)
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to the User collection
  },
  cart_price: {
    type: Number,
    required: true,
    default: 0, // Default value for cart price
  },
  status: {
    type: String,
    enum: ['processing', 'cancel'], // Allow 'processing' and 'cancel' as valid values
    default: 'processing', // Default value for status
  },
});

const Cart = mongoose.model('Cart', cartSchema);


const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  details: {
    type: String
  },
  offer: {
    type: String
  },
  price: {
    type: Number,
    required: true
  },
  category_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  vendor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  }
});
// Example backend endpoint
app.get("/delivery/orders", async (req, res) => {
  const { deliveryPersonId } = req.query;

  try {
    const orders = await Order.find({ delivery_boy_id: deliveryPersonId })
      .populate({
        path: "user_id",
        select: "user_name user_email"
      })
      .populate({
        path: "address_id",
        select: "content",
        populate: {
          path: "user_id", // inside address
          select: "user_name user_email"
        }
      })
      .sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (err) {
    res.status(500).json({ message: "Error fetching orders", error: err.message });
  }
});
// DELETE endpoint for product deletion
app.delete('/product-details/:id', async (req, res) => {
  try {
    // Validate the ID format
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    // Find and delete the product
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);

    if (!deletedProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Optionally: Also delete associated gallery images and reviews
    await ProductGallery.deleteMany({ product_id: req.params.id });
    await ProductReview.deleteMany({ product_id: req.params.id });

    res.json({ 
      success: true,
      message: 'Product and associated data deleted successfully',
      deletedProduct
    });

  } catch (err) {
    console.error('Error deleting product:', err.message);
    res.status(500).json({ 
      success: false,
      message: 'Server error while deleting product',
      error: err.message
    });
  }
});
const Product = mongoose.model('Product', productSchema);

const gallerySchema = new mongoose.Schema({
  gallery_photo: {
    type: String,
    required: true
  },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  }
});
app.get("/gallery/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const images = await Gallery.find({ product_id: productId });

    res.status(200).json(images);
  } catch (err) {
    console.error("Error fetching images:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.delete("/gallery/:imageId", async (req, res) => {
  try {
    const { imageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return res.status(400).json({ message: "Invalid image ID" });
    }

    const deletedImage = await Gallery.findByIdAndDelete(imageId);

    if (!deletedImage) {
      return res.status(404).json({ message: "Image not found" });
    }

    res.status(200).json({ message: "Image deleted successfully" });
  } catch (err) {
    console.error("Error deleting image:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.get('/vendor/:vendorId/top-products', async (req, res) => {
  try {
    const vendorId = req.params.vendorId;

    const result = await Cart.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: 'product_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $match: {
          'product.vendor_id': new mongoose.Types.ObjectId(vendorId)
        }
      },
      {
        $lookup: {
          from: 'galleries',
          localField: 'product._id',
          foreignField: 'product_id',
          as: 'gallery'
        }
      },
      {
        $group: {
          _id: '$product_id',
          totalSales: { $sum: '$qty' },
          productName: { $first: '$product.name' },
          price: { $first: '$product.price' },
          productId: { $first: '$product._id' },
          productImage: { $first: { $arrayElemAt: ['$gallery.gallery_photo', 0] } } // First image
        }
      },
      { $sort: { totalSales: -1 } }
    ]);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error', error });
  }
});
app.get('/vendor/:vendorId/sales', async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { start, end } = req.query;

    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999); // Include full end day

    const sales = await Cart.aggregate([
      {
        $match: {
          status: "processing",
          order_id: { $ne: null },
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: 'product_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: "$product" },
      {
        $match: {
          "product.vendor_id": new mongoose.Types.ObjectId(vendorId)
        }
      },
      {
        $lookup: {
          from: 'orders',
          localField: 'order_id',
          foreignField: '_id',
          as: 'order'
        }
      },
      { $unwind: "$order" },
      {
        $match: {
          "order.date": { $gte: startDate, $lte: endDate }
        }
      },
      {
        $project: {
          productName: "$product.name",
          price: "$product.price",
          qty: 1,
          orderId: { $toString: "$order._id" },
          orderDate: "$order.date"
        }
      }
    ]);

    res.json(sales);
  } catch (err) {
    console.error("Error fetching vendor sales:", err);
    res.status(500).json({ error: "Server Error" });
  }
});
app.get("/vendor/:vendorId/sales/yearly", async (req, res) => {
  try {
    const vendorId = req.params.vendorId;

    const sales = await Cart.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $match: {
          "product.vendor_id": new mongoose.Types.ObjectId(vendorId),
          status: "processing"
        }
      },
      {
        $lookup: {
          from: "orders",
          localField: "order_id",
          foreignField: "_id",
          as: "order"
        }
      },
      { $unwind: "$order" },
      {
        $group: {
          _id: {
            productId: "$product._id",
            productName: "$product.name",
            price: "$product.price",
            year: { $year: "$order.date" }
          },
          totalQty: { $sum: "$qty" },
          totalRevenue: { $sum: "$cart_price" },
          orders: {
            $push: {
              orderId: {
                $substrCP: [
                  { $toString: "$order._id" },
                  { $subtract: [{ $strLenCP: { $toString: "$order._id" } }, 5] },
                  5
                ]
              },
              date: "$order.date"
            }
          }
        }
      }
      ,
      {
        $sort: {
          "_id.year": -1,
          totalRevenue: -1
        }
      }
    ]);

    res.json(sales);
  } catch (error) {
    console.error("Error fetching yearly vendor sales:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});

const Gallery = mongoose.model('Gallery', gallerySchema);

const OrderSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    default: Date.now, // Default to current date if not provided
  },
  vendor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true,
  }, delivery_boy_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPerson',
    default: null,// Reference to the DeliveryPerson collection
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to the Order collection (if applicable)
  },

  address_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address', // Reference to the Address collection
  },
  order_amount: {
    type: Number,
    required: true,
    default: 0, // Default order amount
  },
  status: {
    type: String,
    enum: ['0', '1', '2', '3', '4', '5'], // Fixed 'shipping' to 'shipped'

  },
}, { timestamps: true }); // Adds createdAt and updatedAt timestamps

const Order = mongoose.model('Order', OrderSchema);
app.get('/accepted-vendors', async (req, res) => {
  try {
    const vendors = await Vendor.find({ vendor_status: 'accepted' });
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Vendor Remove Endpoint
app.delete('/vendor-remove/:id', async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }
    res.json({ message: 'Vendor removed successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all products for a specific vendor
app.get('/vendor-products/:vendorId', async (req, res) => {
  try {
    const products = await Product.find({ vendor_id: req.params.vendorId });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get average rating for a product
app.get('/product-average-rating/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ product_id: req.params.productId });
    const avgRating = reviews.length > 0 
      ? reviews.reduce((sum, review) => sum + review.count, 0) / reviews.length 
      : 0;
    res.json({ averageRating: avgRating });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get total complaints for a product (including resolved ones)
app.get('/product-complaints-count/:productId', async (req, res) => {
  try {
    // Find all carts that contain this product
    const cartsWithProduct = await Cart.find({ 
      'product_id': req.params.productId 
    }).distinct('_id');
    
    // Count all complaints associated with these carts (including resolved)
    const count = await Complaint.countDocuments({ 
      cart_id: { $in: cartsWithProduct } 
    });
    
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get breakdown of complaints by status for a product
app.get('/product-complaints-details/:productId', async (req, res) => {
  try {
    // Find all carts that contain this product
    const cartsWithProduct = await Cart.find({ 
      'product_id': req.params.productId 
    }).distinct('_id');
    
    // Get complaint statistics
    const complaints = await Complaint.aggregate([
      { $match: { cart_id: { $in: cartsWithProduct } } },
      { $group: { 
        _id: '$status',
        count: { $sum: 1 }
      }}
    ]);
    
    // Convert to object format
    const result = {
      total: 0,
      pending: 0,
      resolved: 0,
      rejected: 0
    };
    
    complaints.forEach(item => {
      result.total += item.count;
      result[item._id] = item.count;
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get total orders (buys) for a product
app.get('/product-orders-count/:productId', async (req, res) => {
  try {
    // Find all carts that contain this product and have associated orders
    const count = await Cart.countDocuments({ 
      product_id: req.params.productId,
      order_id: { $exists: true, $ne: null }
    });
    
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/orders/update/:id", async (req, res) => {
  try {
    const { id } = req.params; // Extract the order ID from the URL
    const { status } = req.body; // Extract the status from the request body

    // Validate the status
    if (!["4", "5"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value." });
    }

    // Validate the order ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID." });
    }

    // Update the order status
    const order = await Order.findByIdAndUpdate(
      id,
      { status },
      { new: true } // Return the updated document
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    res.status(200).json({ message: "Order status updated successfully.", order });
  } catch (err) {
    console.error("Error updating order status:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.get("/search", async (req, res) => {
  try {
    const { query, latitude, longitude } = req.query;

    if (!query) {
      return res.status(400).json({ message: "Search query is required" });
    }

    if (!latitude || !longitude) {
      return res.status(400).json({ message: "User location is required" });
    }

    // Search for products or shops matching the query
    const products = await Product.find({
      $or: [
        { name: { $regex: query, $options: "i" } }, // Case-insensitive search for product name
        { shopName: { $regex: query, $options: "i" } }, // Case-insensitive search for shop name
      ],
    }).populate("vendor_id");

    if (products.length === 0) {
      return res.status(404).json({ message: "No results found" });
    }

    // Calculate distance and include the first image
    const results = await Promise.all(
      products.map(async (product) => {
        const vendor = product.vendor_id;

        // Check if vendor has valid latitude and longitude
        if (!vendor || !vendor.vendor_lat || !vendor.vendor_lon) {
          return { ...product.toObject(), distance: null, firstImage: null };
        }

        const distance = haversineDistance(
          parseFloat(latitude),
          parseFloat(longitude),
          vendor.vendor_lat,
          vendor.vendor_lon
        );

        // Fetch the first image from the Gallery collection
        const galleryImage = await Gallery.findOne({ product_id: product._id });

        return {
          ...product.toObject(),
          distance,
          firstImage: galleryImage ? galleryImage.gallery_photo : null,
        };
      })
    );

    // Sort results by distance (nearest first)
    results.sort((a, b) => a.distance - b.distance);

    res.json(results);
  } catch (err) {
    console.error("Error fetching search results:", err);
    res.status(500).send("Server error");
  }
});
app.get("/vendor-profile", async (req, res) => {
  try {
    const { vendorId } = req.query;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    res.json(vendor);
  } catch (err) {
    console.error("Error fetching vendor profile:", err.message);
    res.status(500).send("Server error");
  }
});

app.get("/vendor-products-with-order/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;
    console.log("Vendor ID:", vendorId);

    const vendorOrders = await Cart.aggregate([
      {
        $lookup: {
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $match: {
          "product.vendor_id": new mongoose.Types.ObjectId(vendorId),
        },
      },
      {
        $lookup: {
          from: "orders",
          localField: "order_id",
          foreignField: "_id",
          as: "order",
        },
      },
      { $unwind: { path: "$order", preserveNullAndEmptyArrays: true } },

      // ✅ Filter by order status (as string) between '2' and '5'
      {
        $match: {
          "order.status": { $in: ['2', '3', '4', '5'] }
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "order.user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "addresses",
          localField: "user._id",
          foreignField: "user_id",
          as: "address",
        },
      },
      {
        $unwind: {
          path: "$address",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          qty: 1,
          cart_price: 1,
          status: 1,
          "product.name": 1,
          "product.price": 1,
          "order._id": 1,
          "order.date": 1,
          "order.order_amount": 1,
          "order.status": 1,
          "user.user_name": 1,
          "user.user_email": 1,
          "address.content": 1,
        },
      },
    ]);

    res.status(200).json({ success: true, vendorOrders });
  } catch (error) {
    console.error("Error fetching vendor orders:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});


//     const { vendorId } = req.params;

//     if (!vendorId) {
//       return res.status(400).json({ message: "Vendor ID is required" });
//     }

//     // Convert vendorId to ObjectId
//     const vendorObjectId = new ObjectId(vendorId);

//     // Find all orders related to this vendor with status 2-5
//     const orders = await Order.find({
//       vendor_id: vendorObjectId,
//       status: { $in: ["2", "3", "4", "5"] } // Filtering orders with status 2-5
//     }).select("_id status");

//     if (!orders.length) {
//       return res.status(404).json({ message: "No orders found with statuses 2-5 for this vendor" });
//     }

//     // Extract order IDs
//     const orderIds = orders.map(order => order._id);

//     // Find products in Cart that belong to these orders
//     const cartItems = await Cart.find({
//       order_id: { $in: orderIds }
//     }).populate("product_id", "name");

//     if (!cartItems.length) {
//       return res.status(404).json({ message: "No products found for orders with statuses 2-5" });
//     }

//     // Prepare final response with products and order statuses
//     const results = await Promise.all(
//       cartItems.map(async (cartItem) => {
//         const order = orders.find(order => order._id.equals(cartItem.order_id));
//         const galleryImage = await Gallery.findOne({ product_id: cartItem.product_id._id });

//         return {
//           _id: cartItem.product_id._id,
//           name: cartItem.product_id.name,
//           orderStatus: order ? order.status : "Unknown",
//           firstImage: galleryImage ? galleryImage.gallery_photo : null,
//         };
//       })
//     );

//     res.json(results);
//   } catch (err) {
//     console.error("Error fetching vendor products with order statuses:", err);
//     res.status(500).json({ message: "Server error", error: err.message });
//   }
// });

app.get("/api/get-coordinates", async (req, res) => {
  try {
    const { user_id } = req.query;

    // Validate user_id
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Fetch the user from the database
    const user = await User.findById(user_id);
    if (!user || user.latitude === undefined || user.longitude === undefined) {
      return res.status(404).json({ message: "No saved location found" });
    }

    // Return the saved coordinates
    res.json({ latitude: user.latitude, longitude: user.longitude });
  } catch (err) {
    console.error("Error fetching saved location:", err);
    res.status(500).send("Server error");
  }
});



app.post("/orders/pay", async (req, res) => {
  try {
    const { user_id, order_id } = req.body;

    // Validate the user ID and order ID
    if (!mongoose.Types.ObjectId.isValid(user_id) || !mongoose.Types.ObjectId.isValid(order_id)) {
      return res.status(400).json({ message: "Invalid user ID or order ID." });
    }

    // Fetch the order
    const order = await Order.findOne({ _id: order_id, user_id, status: "1" });
    if (!order) {
      return res.status(404).json({ message: "Order not found or already processed." });
    }

    // Update the stock quantity for each product in the cart
    const cartItems = await Cart.find({ order_id });
    for (const cartItem of cartItems) {
      const product = await Product.findById(cartItem.product_id);

      if (product) {
        // Reduce the stock quantity
        product.stock = product.stock - cartItem.qty;

        // Ensure stock doesn't go negative
        if (product.stock < 0) {
          return res.status(400).json({
            message: `Insufficient stock for product: ${product.name}.`,
          });
        }

        await product.save();
      }
    }

    // Update the order status to "2" (Processed)
    order.status = "2";
    await order.save();

    res.status(200).json({ message: "Payment successful! Order updated and stock adjusted." });
  } catch (err) {
    console.error("Error processing payment:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
const deliveryPersonSchema = new mongoose.Schema({


  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true, // Ensure email is unique
  },
  password: {
    type: String,
    required: true,
  },
  a_proof: {
    type: String, // Path to the address proof document
    required: true,
  },
  photo: {
    type: String, // Path to the delivery boy's photo
    required: true,
  },
  status: {
    type: String,
    enum: ["active", "inactive"], // Status can be 'active' or 'inactive'
    default: "inactive",
  },
});
// Get all delivery persons with their proofs
app.get('/api/delivery-persons', async (req, res) => {
  try {
    const deliveryPersons = await DeliveryPerson.find({});
    res.json(deliveryPersons);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single delivery person with proofs
app.get('/api/delivery-persons/:id', async (req, res) => {
  try {
    const person = await DeliveryPerson.findById(req.params.id);
    if (!person) {
      return res.status(404).json({ message: 'Delivery person not found' });
    }
    res.json(person);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
const DeliveryPerson = mongoose.model("DeliveryPerson", deliveryPersonSchema);
app.get("/user/orders/details", async (req, res) => {
  try {
    const { user_id } = req.query;

    // Validate the user ID
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required." });
    }

    // Use aggregation to fetch order details
    const orderDetails = await Cart.aggregate([
      // Match cart items for the given user
      { $match: { user_id: new mongoose.Types.ObjectId(user_id) } },

      // Lookup the associated order details
      {
        $lookup: {
          from: "orders", // Collection name for orders
          localField: "order_id",
          foreignField: "_id",
          as: "order",
        },
      },

      // Unwind the order array (since $lookup returns an array)
      { $unwind: "$order" },

      // Lookup the associated product details
      {
        $lookup: {
          from: "products", // Collection name for products
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },

      // Unwind the product array (since $lookup returns an array)
      { $unwind: "$product" },

      // Project the desired fields
      {
        $project: {
          _id: 0, // Exclude the cart item ID
          order_id: "$order._id",
          order_date: "$order.date",
          last_updated: "$order.updatedAt",
          product_name: "$product.name",
          product_price: "$product.price",
          qty: 1,
          cart_price: 1,
        },
      },
    ]);

    if (!orderDetails || orderDetails.length === 0) {
      return res.status(404).json({ message: "No orders found for this user." });
    }

    res.status(200).json(orderDetails);
  } catch (err) {
    console.error("Error fetching user order details:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.get("/user/orders", async (req, res) => {
  try {
    const { user_id } = req.query;

    // Validate the user ID
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required." });
    }

    // Fetch orders for the user
    const orders = await Order.find({ user_id })
      .populate("vendor_id", "vendor_name")
      .populate("address_id", "content");

    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: "No orders found for this user." });
    }

    res.status(200).json(orders);
  } catch (err) {
    console.error("Error fetching user orders:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


app.post("/user/review", async (req, res) => {
  try {
    const { user_id, product_id, content, count } = req.body;

    // Validate the request body
    if (!user_id || !product_id || !content || !count) {
      return res.status(400).json({ message: "All fields are required." });
    }

    // Create a new review
    const review = new Review({
      user_id,
      product_id,
      content,
      count,
    });

    await review.save();
    res.status(201).json({ message: "Review posted successfully.", review });
  } catch (err) {
    console.error("Error posting review:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.post("/user/review", async (req, res) => {
  try {
    const { user_id, product_id, content, count } = req.body;

    // Validate the request body
    if (!user_id || !product_id || !content || !count) {
      return res.status(400).json({ message: "All fields are required." });
    }

    // Create a new review
    const review = new Review({
      user_id,
      product_id,
      content,
      count,
    });

    await review.save();
    res.status(201).json({ message: "Review posted successfully.", review });
  } catch (err) {
    console.error("Error posting review:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the order ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order ID." });
    }

    // Fetch the order details using aggregation
    const orderDetails = await Order.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
    
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
    
      {
        $lookup: {
          from: "vendors",
          localField: "vendor_id",
          foreignField: "_id",
          as: "vendor",
        },
      },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
    
      {
        $lookup: {
          from: "carts",
          localField: "_id",
          foreignField: "order_id",
          as: "cartItems",
        },
      },
    
      {
        $lookup: {
          from: "products",
          localField: "cartItems.product_id",
          foreignField: "_id",
          as: "products",
        },
      },
    
      // 🆕 Lookup user's address from the `addresses` collection
      {
        $lookup: {
          from: "addresses",
          localField: "user_id",
          foreignField: "user_id",
          as: "addressList",
        },
      },
    
      // 🆕 Add only the first address
      {
        $addFields: {
          address: { $arrayElemAt: ["$addressList", 0] },
        },
      },
    
      {
        $project: {
          _id: 1,
          status: 1,
          order_amount: 1,
          date: 1,
          "user.user_name": 1,
          "user.user_email": 1,
          "vendor.vendor_name": 1,
          address: 1, // Include the resolved address
          cartItems: {
            $map: {
              input: "$cartItems",
              as: "item",
              in: {
                _id: "$$item._id",
                qty: "$$item.qty",
                cart_price: "$$item.cart_price",
                product: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$products",
                        as: "product",
                        cond: { $eq: ["$$product._id", "$$item.product_id"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },
    ]);
    

    // Check if the order exists
    if (!orderDetails || orderDetails.length === 0) {
      return res.status(404).json({ message: "Order not found." });
    }

    // Respond with the order details
    res.status(200).json(orderDetails[0]); // Return the first (and only) result
  } catch (err) {
    console.error("Error fetching order details:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.post("/deliveryperson/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate the request body
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    // Find the delivery person by email
    const deliveryPerson = await DeliveryPerson.findOne({ email });
    if (!deliveryPerson) {
      return res.status(404).json({ message: "Delivery person not found." });
    }

    // Validate the password
    if (deliveryPerson.password !== password) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // Respond with the delivery person ID
    res.status(200).json({ deliveryBoyId: deliveryPerson._id });
  } catch (err) {
    console.error("Error logging in delivery person:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// 📌 GET: Fetch Active Delivery Persons
app.get("/deliverypersons", async (req, res) => {
  try {
    const activeDeliveryPersons = await DeliveryPerson.find({ status: "active" });

    res.json(activeDeliveryPersons);
  } catch (err) {
    console.error("Error fetching delivery persons:", err);
    res.status(500).send("Server error.");
  }
});
app.post("/cart/insert", async (req, res) => {
  try {
    const { user_id, product_id, qty } = req.body;

    // Validate the request
    if (!user_id || !product_id || !qty) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Fetch product details
    const product = await Product.findById(product_id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const cart_price = product.price * qty;

    // Check if there's an existing order with status '1' (confirmed)
    let order = await Order.findOne({ user_id, status: "1" });

    // If no order with status '1', create a new order
    if (!order) {
      order = new Order({
        user_id,
        vendor_id: product.vendor_id, // Include vendor_id from the product
        status: "1", // Order is confirmed
        order_amount: 0, // Initial order amount
      });
      await order.save();
    }

    // Check if the cart item already exists for the same product in the same order
    const existingCartItem = await Cart.findOne({
      user_id,
      product_id,
      order_id: order._id,
    });

    if (existingCartItem) {
      // Update the quantity and cart price if the item already exists
      existingCartItem.qty += qty;
      existingCartItem.cart_price += cart_price;
      await existingCartItem.save();
      order.order_amount += cart_price;
      await order.save();
      return res.status(200).json({ message: "Cart updated", cartItem: existingCartItem, order });
    }

    // Add a new item to the cart linked to the order
    const cartItem = new Cart({
      user_id,
      product_id,
      qty,
      cart_price,
      order_id: order._id, // Link cart item to the order
      status: "processing", // Default status for cart items
    });

    await cartItem.save();

    // Update order total price
    order.order_amount += cart_price;
    await order.save();

    res.status(201).json({ message: "Item added to cart", cartItem, order });
  } catch (error) {
    console.error("Error inserting cart item:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/orders/status/2", async (req, res) => {
  try {
    const ordersWithDetails = await Order.aggregate([
      { $match: { status: "2" } },

      // Lookup user
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },

      // Lookup address by user._id (get only first address)
      {
        $lookup: {
          from: "addresses",
          let: { userId: "$user._id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$user_id", "$$userId"] } } },
            { $limit: 1 }
          ],
          as: "address",
        },
      },
      { $unwind: { path: "$address", preserveNullAndEmptyArrays: true } },

      // Lookup cart items
      {
        $lookup: {
          from: "carts",
          localField: "_id",
          foreignField: "order_id",
          as: "cartItems",
        },
      },

      // Lookup product details
      {
        $lookup: {
          from: "products",
          localField: "cartItems.product_id",
          foreignField: "_id",
          as: "products",
        },
      },

      // Final projection
      {
        $project: {
          _id: 1,
          status: 1,
          "user.user_name": 1,
          "user.user_email": 1,
          "address.content": 1, // first address content of user
          cartItems: {
            $map: {
              input: "$cartItems",
              as: "item",
              in: {
                _id: "$$item._id",
                qty: "$$item.qty",
                cart_price: "$$item.cart_price",
                product: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$products",
                        as: "product",
                        cond: { $eq: ["$$product._id", "$$item.product_id"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },
    ]);

    if (!ordersWithDetails || ordersWithDetails.length === 0) {
      return res.status(404).json({ message: "No orders with status '2' found." });
    }

    res.status(200).json(ordersWithDetails);
  } catch (err) {
    console.error("Server error while fetching orders:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.put("/delivery/orders/accept/:id", async (req, res) => {
  try {
    const { id } = req.params; // Extract the order ID from the URL
    const { status, delivery_boy_id } = req.body; // Extract the status and delivery person ID from the request body

    // Validate the delivery_boy_id
    const deliveryPerson = await DeliveryPerson.findById(delivery_boy_id);
    if (!deliveryPerson) {
      return res.status(404).json({ message: "Delivery person not found." });
    }

    // Update the order status and assign the delivery person
    const order = await Order.findByIdAndUpdate(
      id,
      { status, delivery_boy_id }, // Update both status and delivery_boy_id
      { new: true } // Return the updated document
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    res.status(200).json({
      message: "Order status updated and delivery person assigned successfully.",
      order,
    });
  } catch (err) {
    console.error("Error updating order status:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.put("/user/:id/change-password", async (req, res) => {
  const userId = req.params.id;
  const { currentPassword, newPassword } = req.body;

  try {
    // Find the user by ID
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if current password matches
    if (user.user_password !== currentPassword) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Update to new password
    user.user_password = newPassword;

    // Save the updated user
    await user.save();

    res.json({ success: true, message: "Password changed successfully", user });
  } catch (err) {
    console.error("Error changing password:", err);
    res.status(500).json({ message: "Server error" });
  }
});
app.put("/deliveryperson/cart/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const cartItem = await Cart.findById(id);
    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found." });
    }

    cartItem.status = "shipped";
    await cartItem.save();

    res.json({ message: "Cart item status updated to shipped." });
  } catch (err) {
    console.error("Error updating cart status:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.post("/order/confirm", async (req, res) => {
  try {
    const { user_id } = req.body;

    // Find the pending order
    const order = await Order.findOne({ user_id, status: "0" });

    if (!order) {
      return res.status(400).json({ message: "No active cart found" });
    }

    // Update order status to "1" (confirmed)
    order.status = "1";
    await order.save();

    // Update all cart items related to this order to "shipped"
    await Cart.updateMany({ order_id: order._id }, { $set: { status: "shipped" } });

    res.json({ message: "Order confirmed", order });
  } catch (error) {
    console.error("Error confirming order:", error);
    res.status(500).json({ error: error.message });
  }
});
app.put("/cart/update", async (req, res) => {
  try {
    const { itemId, qty } = req.body;
    const cartItem = await Cart.findById(itemId);
    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found." });
    }

    cartItem.qty = qty;
    cartItem.cart_price = cartItem.product_price * qty;
    await cartItem.save();

    res.status(200).json({ message: "Quantity updated successfully." });
  } catch (err) {
    console.error("Error updating quantity:", err);
    res.status(500).json({ message: "Server error." });
  }
});
app.delete("/cart/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the cart item ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid cart item ID." });
    }

    // Find the cart item to get the associated order ID and cart price
    const cartItem = await Cart.findById(id);
    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found." });
    }

    const { order_id, cart_price } = cartItem;

    // Remove the cart item from the Cart collection
    await Cart.findByIdAndDelete(id);

    // Update the total price in the Order collection
    const order = await Order.findById(order_id);
    if (order) {
      order.order_amount -= cart_price; // Subtract the cart price from the total order amount

      if (order.order_amount <= 0) {
        // If the order amount is 0 or less, delete the order
        await Order.findByIdAndDelete(order_id);
      } else {
        // Otherwise, save the updated order
        await order.save();
      }
    }

    res.status(200).json({ message: "Cart item removed and order updated successfully." });
  } catch (err) {
    console.error("Error deleting cart item:", err);
    res.status(500).json({ message: "Server error." });
  }
});

app.get("/user/orders/products", async (req, res) => {
  try {
    const { user_id } = req.query;
console.log("User ID:", user_id);
    // Validate the user ID
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required." });
    }

    // Use aggregation to fetch products of orders for the user
    const orderProducts = await Order.aggregate([
      // Match orders for the given user with statuses 2-5
      { $match: { user_id: new mongoose.Types.ObjectId(user_id), status: { $in: ["2", "3", "4", "5"] } } },

      // Lookup cart items associated with the order
      {
        $lookup: {
          from: "carts", // Collection name for cart items
          localField: "_id",
          foreignField: "order_id",
          as: "cartItems",
        },
      },

      // Lookup product details for each cart item
      {
        $lookup: {
          from: "products", // Collection name for products
          localField: "cartItems.product_id",
          foreignField: "_id",
          as: "products",
        },
      },

      // Lookup gallery images for each product
      {
        $lookup: {
          from: "galleries", // Collection name for galleries
          localField: "products._id",
          foreignField: "product_id",
          as: "gallery",
        },
      },

      // Project the desired fields
      {
        $project: {
          _id: 1,
          status: 1, // Include the status of the order
          date: 1, // Include the order date
          delivery_date: "$updatedAt", // Include the delivery date
          cartItems: {
            $map: {
              input: "$cartItems",
              as: "item",
              in: {
                _id: "$$item._id",
                qty: "$$item.qty",
                cart_price: "$$item.cart_price",
                product: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$products",
                        as: "product",
                        cond: { $eq: ["$$product._id", "$$item.product_id"] },
                      },
                    },
                    0,
                  ],
                },
                gallery_image: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$gallery",
                        as: "image",
                        cond: { $eq: ["$$image.product_id", "$$item.product_id"] },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },
    ]);
    console.log("Order Products:", orderProducts);

    if (!orderProducts || orderProducts.length === 0) {
      return res.status(404).json({ message: "No orders found for this user." });
    }

    res.status(200).json(orderProducts);
  } catch (err) {
    console.error("Error fetching user order products:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.post('/complaints', async (req, res) => {
  try {
    const { title, content, cart_id, user_id } = req.body;

    // Detailed validation for each required field
    const missingFields = [];
    if (!title) missingFields.push('title');
    if (!content) missingFields.push('content');
    if (!cart_id) missingFields.push('cart_id');
    if (!user_id) missingFields.push('user_id');

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: "Missing required fields",
        missingFields,
        details: {
          title: !title ? "Title is required" : undefined,
          content: !content ? "Content is required" : undefined,
          cart_id: !cart_id ? "Cart ID is required" : undefined,
          user_id: !user_id ? "User ID is required" : undefined
        }
      });
    }

    // Validate title length
    if (title.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Title must be 100 characters or less"
      });
    }

    // Validate content length
    if (content.length < 20) {
      return res.status(400).json({
        success: false,
        message: "Content must be at least 20 characters"
      });
    }

    // Create and save complaint
    const complaint = new Complaint({
      title: title.trim(),
      content: content.trim(),
      cart_id,
      user_id,
      status: "pending",
      reply: null // Explicitly setting default
    });

    await complaint.save();

    res.status(201).json({
      success: true,
      data: {
        complaint_id: complaint._id,
        title: complaint.title,
        content: complaint.content,
        status: complaint.status,
        cart_id: complaint.cart_id,
        user_id: complaint.user_id,
        createdAt: complaint.createdAt,
        updatedAt: complaint.updatedAt
      },
      message: "Complaint submitted successfully"
    });

  } catch (err) {
    console.error("Error submitting complaint:", err);
    
    // Handle duplicate complaints or other specific errors
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate complaint detected"
      });
    }

    res.status(500).json({ 
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

app.get('/user/complaints/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID format' 
      });
    }

    const complaints = await Complaint.aggregate([
      { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
      {
        $lookup: {
          from: 'carts',
          localField: 'cart_id',
          foreignField: '_id',
          as: 'cart'
        }
      },
      { $unwind: '$cart' },
      {
        $lookup: {
          from: 'products',
          localField: 'cart.product_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'galleries', // Ensure correct collection name
          localField: 'product._id',
          foreignField: 'product_id',
          as: 'gallery_images'
        }
      },
      {
        $addFields: {
          first_image: { $arrayElemAt: ['$gallery_images.gallery_photo', 0] }
        }
      },
      {
        $project: {
          _id: 1,
          title: 1,
          content: 1,
          reply: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          product: {
            name: 1,
            price: 1,
            description: 1
          },
          purchase: {
            date: '$cart.createdAt',
            quantity: '$cart.qty'
          },
          gallery_image: '$first_image', // Extract only first image
          total: '$cart.cart_price'
        }
      },
      { $sort: { createdAt: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: complaints
    });

  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

app.get("/product/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the product ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    // Use aggregation to fetch product details, gallery image, and latest stock
    const productDetails = await Product.aggregate([
      // Match the product by ID
      { $match: { _id: new mongoose.Types.ObjectId(id) } },

      // Lookup the first image from the Gallery collection
      {
        $lookup: {
          from: "galleries", // Collection name for galleries
          localField: "_id",
          foreignField: "product_id",
          as: "gallery",
        },
      },

      // Add the first image from the gallery
      {
        $addFields: {
          image: { $arrayElemAt: ["$gallery.gallery_photo", 0] }, // Get the first image
        },
      },

      // Lookup the latest stock from the Stock collection
      {
        $lookup: {
          from: "stocks", // Collection name for stocks
          localField: "_id",
          foreignField: "product_id",
          as: "stocks",
        },
      },

      // Add the latest stock quantity
      {
        $addFields: {
          latestStock: {
            $arrayElemAt: [
              {
                $sortArray: {
                  input: "$stocks",
                  sortBy: { stock_date: -1 }, // Sort stocks by date in descending order
                },
              },
              0,
            ],
          },
        },
      },

      // Project the desired fields
      {
        $project: {
          _id: 1,
          name: 1,
          description: 1,
          details:1,
          offer:1,
          
          price: 1,
          image: 1, // Include the first image
          stock: "$latestStock.stock_quantity", // Include the latest stock quantity
        },
      },
    ]);

    if (!productDetails || productDetails.length === 0) {
      return res.status(404).json({ message: "Product not found." });
    }

    // Fetch reviews for the product
    const reviews = await Review.aggregate([
      { $match: { product_id: new mongoose.Types.ObjectId(id) } },
      {
        $lookup: {
          from: "users", // Collection name for users
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" }, // Unwind the user array to get a single object
      {
        $project: {
          _id: 1,
          content: 1,
          count: 1, // Rating count
          createdAt: 1,
          "user.user_name": 1, // Include the user's name
        },
      },
    ]);

    // Calculate average rating
    const totalRating = reviews.reduce((sum, review) => sum + review.count, 0);
    const avgRating = reviews.length > 0 ? (totalRating / reviews.length).toFixed(1) : 0;

    res.status(200).json({
      product: productDetails[0],
      reviews,
      avgRating,
    });
  } catch (err) {
    console.error("Error fetching product details:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.get("/product/:id/reviews", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the product ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    // Use aggregation to fetch reviews with user details
    const reviews = await Review.aggregate([
      { $match: { product_id: new mongoose.Types.ObjectId(id) } },
      {
        $lookup: {
          from: "users", // Collection name for users
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" }, // Unwind the user array to get a single object
      {
        $project: {
          _id: 1,
          content: 1,
          count: 1, // Rating count
          "user.user_name": 1, // Include the user's name
        },
      },
    ]);

    res.status(200).json(reviews);
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.get("/product-reviews/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product ID." });
    }

    const reviews = await Review.aggregate([
      { $match: { product_id: new mongoose.Types.ObjectId(productId) } },
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 1,
          content: 1,
          count: 1,
          createdAt: 1,
          "user.user_name": 1,
        },
      },
    ]);

    res.status(200).json(reviews);
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Add a product review
app.post("/product-reviews", async (req, res) => {
  try {
    const { product_id, user_id, content, count } = req.body;

    if (!mongoose.Types.ObjectId.isValid(product_id) || !mongoose.Types.ObjectId.isValid(user_id)) {
      return res.status(400).json({ message: "Invalid product or user ID." });
    }

    const newReview = new Review({
      product_id: new mongoose.Types.ObjectId(product_id),
      user_id: new mongoose.Types.ObjectId(user_id),
      content,
      count,
      createdAt: new Date(),
    });

    await newReview.save();
    res.status(201).json({ message: "Review added successfully." });
  } catch (err) {
    console.error("Error adding review:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.get("/cart/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    // Validate user ID
    if (!mongoose.Types.ObjectId.isValid(user_id)) {
      return res.status(400).json({ message: "Invalid user ID." });
    }

    const cartItems = await Cart.aggregate([
      // Lookup the order linked to each cart item
      {
        $lookup: {
          from: "orders",
          localField: "order_id",
          foreignField: "_id",
          as: "order",
        },
      },
      { $unwind: "$order" },

      // Match cart items with orders that belong to the user and have status "1"
      {
        $match: {
          "order.user_id": new mongoose.Types.ObjectId(user_id),
          "order.status": "1",
        },
      },

      // Lookup product details
      {
        $lookup: {
          from: "products",
          localField: "product_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },

      // Lookup gallery images
      {
        $lookup: {
          from: "galleries",
          localField: "product._id",
          foreignField: "product_id",
          as: "gallery",
        },
      },

      // Get the first gallery image
      {
        $addFields: {
          firstImage: {
            $ifNull: [{ $arrayElemAt: ["$gallery.gallery_photo", 0] }, null],
          },
        },
      },

      // Final projection
      {
        $project: {
          _id: 1,
          order_id: "$order._id",
          product_id: "$product._id",
          product_name: "$product.name",
          product_price: "$product.price",
          qty: 1,
          cart_price: 1,
          firstImage: 1,
        },
      },
    ]);
console.log("Fetched cart items:", cartItems); // Debugging
    if (!cartItems.length) {
      return ({ message: "No cart items found for this user with active orders." });
    }

    res.status(200).json({cartItems});
  } catch (error) {
    console.error("Error fetching cart items:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

app.get("/order/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const orders = await Order.find({ user_id }).populate("vendor_id").populate("address_id");

    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post('/user/upload-profile', 
  upload.single('profile'), 
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      
      // Update user's profile photo in database
      const user = await User.findByIdAndUpdate(
        req.user._id,
        { user_photo: req.file.filename },
        { new: true }
      ).select('-user_password -__v');
      
      res.json({ filename: req.file.filename, user });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Remove profile picture
app.delete("/user/:id/profile-photo", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Ensure there's a photo to delete
    if (!user.user_photo) {
      return res.status(400).json({ message: "No profile photo to delete" });
    }

    // Delete file from the uploads folder (if stored locally)
    const fs = require("fs");
    const photoPath = `uploads/${user.user_photo}`;
    if (fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath); // Delete the file
    }

    // Update user document
    user.user_photo = null;
    await user.save();

    res.json({ message: "Profile photo removed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/user-orders", async (req, res) => {
  try {
    const { user_id } = req.query;
    console.log("Received user_id:", user_id); // Debugging

    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const cartItems = await Cart.find({ user_id })
      .populate({
        path: "product_id",
        populate: [
          { path: "vendor_id", model: "Vendor" },
          { path: "gallery_id", model: "Gallery" },
        ],
      })
      .populate("order_id")
      .populate("delivery_boy_id");

    console.log("Fetched cart items:", cartItems); // Debugging

    if (!cartItems || cartItems.length === 0) {
      return res.status(404).json({ message: "No orders found for this user." });
    }

    const formattedOrders = cartItems.map((item) => ({
      _id: item._id,
      product_id: {
        _id: item.product_id?._id,
        name: item.product_id?.name,
        image: item.product_id?.gallery_id?.image,
        vendor_id: {
          shop_name: item.product_id?.vendor_id?.shop_name,
        },
      },
      qty: item.qty,
      cart_price: item.cart_price,
      status: item.status,
      order_id: item.order_id?._id,
      delivery_boy_id: item.delivery_boy_id,
    }));

    res.json(formattedOrders);
  } catch (err) {
    console.error("Error fetching user orders:", err); // Debugging
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
// Login delivery person

app.get("/deliveryperson/pending-orders", async (req, res) => {
  try {
    const orders = await Order.find({ status: "1" }) // Fetch confirmed orders
      .populate("user_id", "user_name user_email") // Populate user details
      .populate("address_id", "content") // Populate address details
      .populate({
        path: "vendor_id",
        select: "vendor_name",
      });

    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: "No pending orders found." });
    }

    const formattedOrders = await Promise.all(
      orders.map(async (order) => {
        const cartItems = await Cart.find({ order_id: order._id, status: "processing" }) // Only processing items
          .populate("product_id", "name price");

        return {
          order_id: order._id,
          user: order.user_id,
          address: order.address_id?.content,
          vendor: order.vendor_id?.vendor_name,
          cartItems: cartItems.map((item) => ({
            _id: item._id,
            product: item.product_id,
            qty: item.qty,
            cart_price: item.cart_price,
            status: item.status,
          })),
        };
      })
    );

    // Filter out orders with no processing cart items
    const ordersWithProcessingItems = formattedOrders.filter(
      (order) => order.cartItems.length > 0
    );

    res.json(ordersWithProcessingItems);
  } catch (err) {
    console.error("Error fetching pending orders:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.put("/deliveryperson/cart/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const cartItem = await Cart.findById(id);
    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found." });
    }

    cartItem.status = "shipped";
    await cartItem.save();

    res.json({ message: "Cart item status updated to shipped." });
  } catch (err) {
    console.error("Error updating cart status:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.put("/orders/accept/:id", async (req, res) => {
  try {
    const { id } = req.params; // Extract the order ID from the URL
    const { status } = req.body; // Extract the status from the request body

    // Update the order status in the database
    const order = await Order.findByIdAndUpdate(
      id,
      { status },
      { new: true } // Return the updated document
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    res.status(200).json({ message: "Order status updated successfully.", order });
  } catch (err) {
    console.error("Error updating order status:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});
app.post("/order/confirm", async (req, res) => {
  try {
    const { user_id } = req.body;

    // Find the pending order
    const order = await Order.findOne({ user_id, status: "0" });

    if (!order) {
      return res.status(400).json({ message: "No active cart found" });
    }

    // Update order status to "1" (confirmed)
    order.status = "1";
    await order.save();

    // Update all cart items related to this order to "shipped"
    await Cart.updateMany({ order_id: order._id }, { $set: { status: "shipped" } });

    res.json({ message: "Order confirmed", order });
  } catch (error) {
    console.error("Error confirming order:", error);
    res.status(500).json({ error: error.message });
  }
});
app.get("/delivery/orders", async (req, res) => {
  const { deliveryPersonId } = req.query;

  if (!deliveryPersonId) {
    return res.status(400).json({ message: "Delivery person ID is required." });
  }

  try {
    const orders = await Order.find({ 
        deliveryPerson: deliveryPersonId, 
        status: "Delivered" 
      })
      .populate("user_id", "user_name")       // Populate user's name
      .populate("address_id", "content")      // Populate address content
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Failed to fetch orders." });
  }
});
app.get("/delivery/orders/available", async (req, res) => {
  try {
    // Fetch orders with status "2" (no delivery boy assigned)
    const orders = await Order.find({ status: "2" })
      .populate("user_id", "user_name user_email") // Populate user details
      .populate("address_id", "content") // Populate address details
      .populate({
        path: "cartItems", // Populate cart items
        populate: {
          path: "product_id",
          select: "name price", // Populate product details
        },
      });

    // Check if orders exist
    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: "No available orders found." });
    }

    // Respond with the fetched orders
    res.status(200).json({ orders });
  } catch (error) {
    console.error("Error fetching available orders:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

module.exports = { Admin, Review, Order, Cart, Category, Vendor, Product, Complaint,Gallery, Stock, User, Address, UserCoordinates, DeliveryPerson };