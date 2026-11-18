// Usage (run from the backend folder):
//   node seeder.js      -> deletes ALL products, then inserts the 4 samples
//   node seeder.js -d   -> deletes ALL products and stops
require('dotenv').config();

const mongoose = require('mongoose');
const dbModule = require('./config/db');
const Product = require('./models/Product');

// Works whether db.js exports the function directly or as { connectDB }
const connectDB = dbModule.connectDB || dbModule;

const placeholder = (text) =>
  `https://placehold.co/800x600/000000/FFFFFF?text=${encodeURIComponent(text)}`;

const sampleProducts = [
  {
    name: 'AceySecure 4MP Dome Camera',
    description:
      'Compact indoor dome camera with sharp 4MP video, night vision and motion alerts. Ideal for shops, offices and living areas.',
    price: 45000,
    image: placeholder('Dome Camera'),
    brand: 'AceySecure',
    category: 'Indoor Cameras',
    countInStock: 25,
    rating: 4.5,
  },
  {
    name: 'AceySecure 5MP Bullet Camera',
    description:
      'Weather-resistant outdoor bullet camera with 5MP video and long-range night vision for gates, compounds and driveways.',
    price: 62000,
    image: placeholder('Bullet Camera'),
    brand: 'AceySecure',
    category: 'Outdoor Cameras',
    countInStock: 18,
    rating: 4.6,
  },
  {
    name: 'AceySecure 4-Camera Surveillance Kit',
    description:
      'Complete kit with four cameras, a recorder, cables and power supplies, ready to install and watch from your phone.',
    price: 285000,
    image: placeholder('Surveillance Kit'),
    brand: 'AceySecure',
    category: 'Complete Systems',
    countInStock: 8,
    rating: 4.8,
  },
  {
    name: 'AceySecure Solar Wireless Camera',
    description:
      'Wire-free outdoor camera powered by a built-in solar panel. Good for places with no nearby power source.',
    price: 98000,
    image: placeholder('Solar Camera'),
    brand: 'AceySecure',
    category: 'Outdoor Cameras',
    countInStock: 12,
    rating: 4.3,
  },
];

const run = async () => {
  try {
    await connectDB();
    await Product.deleteMany();

    if (process.argv[2] === '-d') {
      console.log('All products deleted');
    } else {
      await Product.insertMany(sampleProducts);
      console.log(`Seeded ${sampleProducts.length} products`);
    }
  } catch (error) {
    console.error('Seeder failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    process.exit();
  }
};

run();