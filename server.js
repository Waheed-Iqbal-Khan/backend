const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// Enable CORS for all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

// Initialize Firebase Admin SDK
try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is required');
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
  
  console.log('✅ Firebase Admin SDK initialized successfully');
  console.log('📱 Project ID:', serviceAccount.project_id);
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
  console.error('📝 Make sure FIREBASE_SERVICE_ACCOUNT environment variable is set with valid JSON');
}

// Health check endpoint - shows backend status
app.get('/', (req, res) => {
  const isFirebaseInitialized = admin.apps.length > 0;
  
  res.json({
    status: '🚀 Push Notification Backend is Running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    firebase: isFirebaseInitialized ? '✅ Connected' : '❌ Not Connected',
    endpoints: {
      health: 'GET /',
      send: 'POST /send-notification',
      test: 'GET /test'
    },
    environment: {
      nodeVersion: process.version,
      port: process.env.PORT || 3000,
      hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT
    }
  });
});

// Test endpoint to verify everything is working
app.get('/test', (req, res) => {
  const isFirebaseReady = admin.apps.length > 0;
  
  res.json({
    message: '🧪 Backend Test Successful!',
    firebase: isFirebaseReady ? 'Ready ✅' : 'Not Ready ❌',
    timestamp: new Date().toISOString(),
    ready: isFirebaseReady
  });
});

// Main endpoint to send push notifications
app.post('/send-notification', async (req, res) => {
  console.log('📥 Received notification request');
  
  try {
    // Check if Firebase is initialized
    if (admin.apps.length === 0) {
      console.error('❌ Firebase Admin not initialized');
      return res.status(500).json({
        success: false,
        error: 'Firebase Admin SDK not initialized. Check service account configuration.'
      });
    }

    const { targetToken, title, body, data } = req.body;

    // Validate required fields
    if (!targetToken || !title || !body) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: targetToken, title, body',
        received: {
          targetToken: !!targetToken,
          title: !!title,
          body: !!body
        }
      });
    }

    console.log('📤 Sending notification:');
    console.log('  📝 Title:', title);
    console.log('  💬 Body:', body);
    console.log('  🎯 Target:', targetToken.substring(0, 20) + '...');

    // Create the FCM message
    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: data || {},
      token: targetToken,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          icon: 'ic_notification',
          color: '#2196F3',
          channelId: 'high_importance_channel',
          tag: 'flutter_notification',
          visibility: 'public'
        },
        ttl: 86400000, // 24 hours
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: title,
              body: body
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
      webpush: {
        notification: {
          title: title,
          body: body,
          icon: '/icon-192x192.png'
        }
      }
    };

    // Send the notification using Firebase Admin SDK
    const response = await admin.messaging().send(message);
    
    console.log('✅ Notification sent successfully!');
    console.log('🆔 Message ID:', response);
    
    // Return success response
    res.json({
      success: true,
      messageId: response,
      timestamp: new Date().toISOString(),
      targetPreview: targetToken.substring(0, 20) + '...',
      title: title,
      body: body
    });

  } catch (error) {
    console.error('❌ Error sending notification:', error);
    
    // Handle specific Firebase errors
    let errorMessage = 'Failed to send notification';
    let statusCode = 500;
    
    if (error.code === 'messaging/registration-token-not-registered') {
      errorMessage = 'Device token is not registered (app may be uninstalled)';
      statusCode = 404;
      console.log('🔍 Token not registered - app may be uninstalled or token expired');
    } else if (error.code === 'messaging/invalid-registration-token') {
      errorMessage = 'Invalid device token format';
      statusCode = 400;
      console.log('🔍 Invalid token format');
    } else if (error.code === 'messaging/invalid-argument') {
      errorMessage = 'Invalid message format or parameters';
      statusCode = 400;
      console.log('🔍 Invalid message parameters');
    } else if (error.code === 'messaging/authentication-error') {
      errorMessage = 'Authentication error - check service account';
      statusCode = 401;
      console.log('🔍 Authentication failed - check service account configuration');
    }
    
    // Return error response
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: error.message,
      code: error.code || 'unknown',
      timestamp: new Date().toISOString()
    });
  }
});

// Bulk notification endpoint (bonus feature)
app.post('/send-bulk-notifications', async (req, res) => {
  try {
    const { targetTokens, title, body, data } = req.body;

    if (!Array.isArray(targetTokens) || targetTokens.length === 0 || !title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: targetTokens (non-empty array), title, body'
      });
    }

    console.log(`📤 Sending bulk notification to ${targetTokens.length} devices`);

    const message = {
      notification: { title, body },
      data: data || {},
      tokens: targetTokens,
      android: {
        priority: 'high',
        notification: { sound: 'default' }
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } }
      }
    };

    const response = await admin.messaging().sendMulticast(message);
    
    console.log(`✅ Bulk notification complete: ${response.successCount} success, ${response.failureCount} failed`);
    
    res.json({
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      totalCount: targetTokens.length,
      responses: response.responses.map((resp, index) => ({
        token: targetTokens[index].substring(0, 20) + '...',
        success: resp.success,
        messageId: resp.messageId,
        error: resp.error ? resp.error.message : null
      }))
    });

  } catch (error) {
    console.error('❌ Bulk notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk notifications',
      details: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: error.message,
    timestamp: new Date().toISOString()
  });
});

// Handle 404 for unknown endpoints
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /test',
      'POST /send-notification',
      'POST /send-bulk-notifications'
    ]
  });
});

// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Push Notification Backend started successfully!`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 Backend URL: ${process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`}`);
  console.log(`🔥 Firebase Admin: ${admin.apps.length > 0 ? 'Ready ✅' : 'Not Ready ❌'}`);
  console.log(`📱 Ready to send push notifications!`);
});
