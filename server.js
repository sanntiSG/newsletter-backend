const os = require('os');

require('dotenv').config({ path: process.env.NODE_ENV === 'development' ? '.env.local' : '.env' });

// ============= CONFIGURACIÓN - EDITAR AQUÍ =============
const CONFIG = {
  PORT: process.env.PORT || 5000,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5555',
  NODE_ENV: process.env.NODE_ENV || 'production',
  USE_GMAIL: process.env.USE_GMAIL === 'true',
  MONGODB_URI: process.env.MONGODB_URI,

  // Resend (producción)
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM || 'onboarding@resend.dev',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'NOTI Demo',

  // Gmail (desarrollo local)
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,

  // Admin
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};
// ======================================================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// ===== CORS mejorado =====
const allowedOrigins = [
  CONFIG.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5555',
  'http://localhost:3000',
  'https://eternumdemo.netlify.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir si no hay origin (como Postman), si está en allowedOrigins, 
    // o si es una IP de red local (192.168.x.x o 10.x.x.x) en desarrollo
    const isLocalNetwork = origin && (origin.startsWith('http://192.168.') || origin.startsWith('http://10.'));

    if (!origin || allowedOrigins.includes(origin) || (CONFIG.NODE_ENV === 'development' && isLocalNetwork)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// ========== CONFIGURACIÓN DUAL: MONGODB O JSON FILES ==========
let useMongoDB = false;
let mongoose, Email, Stats;

if (CONFIG.MONGODB_URI) {
  // Usar MongoDB (producción)
  mongoose = require('mongoose');

  mongoose.connect(CONFIG.MONGODB_URI)
    .then(() => {
      console.log('✅ MongoDB conectado correctamente');
      console.log('   Base de datos persistente activada');
      useMongoDB = true;
    })
    .catch((err) => {
      console.error('❌ Error conectando a MongoDB:', err.message);
      console.error('💡 Cambiando a archivos JSON locales como respaldo');
      useMongoDB = false;
    });

  // Modelos de MongoDB
  const emailSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    subscribedAt: { type: Date, default: Date.now },
    verified: { type: Boolean, default: false }
  });

  const statsSchema = new mongoose.Schema({
    totalClicks: { type: Number, default: 0 },
    emailsByDay: { type: Map, of: Number, default: {} },
    totalEmails: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
  });

  Email = mongoose.model('Email', emailSchema);
  Stats = mongoose.model('Stats', statsSchema);
} else {
  // Usar archivos JSON (desarrollo)
  console.log('📁 Usando archivos JSON locales para almacenamiento');
  console.log('   Los datos se guardarán en backend/data/');
}

// Base de datos en memoria (para modo JSON)
let emailsDB = [];
let statsDB = {
  totalClicks: 0,
  emailsByDay: {},
  totalEmails: 0,
  lastUpdated: new Date()
};

// ========== HELPERS PARA DATOS ==========

// Cargar datos desde JSON (solo en modo local)
const loadDataFromJSON = async () => {
  if (useMongoDB) return;

  try {
    const emailsData = await fs.readFile('data/emails.json', 'utf8');
    const statsData = await fs.readFile('data/stats.json', 'utf8');
    emailsDB = JSON.parse(emailsData);
    statsDB = JSON.parse(statsData);
    console.log(`📊 Datos cargados desde JSON: ${emailsDB.length} emails registrados`);
  } catch (error) {
    console.log('📝 Iniciando con base de datos vacía (archivos JSON)');
  }
};

// Guardar datos en JSON (solo en modo local)
const saveDataToJSON = async () => {
  if (useMongoDB) return;

  try {
    await fs.mkdir('data', { recursive: true });
    await fs.writeFile('data/emails.json', JSON.stringify(emailsDB, null, 2));
    await fs.writeFile('data/stats.json', JSON.stringify(statsDB, null, 2));
  } catch (error) {
    console.error('❌ Error guardando datos en JSON:', error);
  }
};

// Obtener/crear stats (unificado para MongoDB y JSON)
const getStats = async () => {
  if (useMongoDB) {
    let stats = await Stats.findOne();
    if (!stats) {
      stats = await Stats.create({
        totalClicks: 0,
        emailsByDay: {},
        totalEmails: 0
      });
    }
    return stats;
  } else {
    return statsDB;
  }
};

// Guardar stats (unificado)
const saveStats = async (stats) => {
  if (useMongoDB) {
    await stats.save();
  } else {
    await saveDataToJSON();
  }
};

// Buscar email (unificado)
const findEmail = async (emailAddress) => {
  if (useMongoDB) {
    return await Email.findOne({ email: emailAddress });
  } else {
    return emailsDB.find(e => e.email === emailAddress);
  }
};

// Crear email (unificado)
const createEmail = async (emailAddress) => {
  if (useMongoDB) {
    return await Email.create({
      email: emailAddress,
      subscribedAt: new Date(),
      verified: false
    });
  } else {
    const newEmail = {
      email: emailAddress,
      subscribedAt: new Date().toISOString(),
      verified: false
    };
    emailsDB.push(newEmail);
    await saveDataToJSON();
    return newEmail;
  }
};

// Obtener todos los emails (unificado)
const getAllEmails = async () => {
  if (useMongoDB) {
    return await Email.find().sort({ subscribedAt: -1 });
  } else {
    return [...emailsDB].reverse();
  }
};

// Contar emails (unificado)
const countEmails = async (filter = {}) => {
  if (useMongoDB) {
    return await Email.countDocuments(filter);
  } else {
    if (filter.verified !== undefined) {
      return emailsDB.filter(e => e.verified === filter.verified).length;
    }
    return emailsDB.length;
  }
};

// Eliminar email (unificado)
const deleteEmail = async (emailAddress) => {
  if (useMongoDB) {
    const result = await Email.deleteOne({ email: emailAddress });
    return result.deletedCount > 0;
  } else {
    const index = emailsDB.findIndex(e => e.email === emailAddress);
    if (index !== -1) {
      emailsDB.splice(index, 1);
      await saveDataToJSON();
      return true;
    }
    return false;
  }
};

// Configuración de multer para imágenes
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = 'uploads';
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  }
});

// ========== CONFIGURACIÓN DUAL: RESEND O GMAIL ==========
let emailService = null;
let emailProvider = 'unknown';

if (CONFIG.USE_GMAIL && CONFIG.EMAIL_USER && CONFIG.EMAIL_PASSWORD) {
  const nodemailer = require('nodemailer');

  emailService = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: CONFIG.EMAIL_USER,
      pass: CONFIG.EMAIL_PASSWORD.replace(/\s/g, '')
    },
    tls: { rejectUnauthorized: false }
  });

  emailProvider = 'Gmail';
  console.log('📧 Modo DESARROLLO: Usando Gmail/Nodemailer');
  console.log('   Email:', CONFIG.EMAIL_USER);

  emailService.verify()
    .then(() => console.log('✅ Gmail configurado correctamente'))
    .catch((err) => console.error('❌ Error en Gmail:', err.message));

} else if (CONFIG.RESEND_API_KEY) {
  const { Resend } = require('resend');
  emailService = new Resend(CONFIG.RESEND_API_KEY);
  emailProvider = 'Resend';

  console.log('🚀 Modo PRODUCCIÓN: Usando Resend');
  console.log('   From Email:', CONFIG.EMAIL_FROM);
  console.log('   From Name:', CONFIG.EMAIL_FROM_NAME);
} else {
  console.error('❌ No hay servicio de email configurado');
}

// Helper unificado para enviar emails
const sendEmail = async ({ to, subject, html }) => {
  if (!emailService) {
    throw new Error('Servicio de email no configurado');
  }

  try {
    if (emailProvider === 'Gmail') {
      const info = await emailService.sendMail({
        from: `"${CONFIG.EMAIL_FROM_NAME}" <${CONFIG.EMAIL_USER}>`,
        to: to,
        subject: subject,
        html: html,
      });

      console.log(`✅ [Gmail] Email enviado a: ${to}`);
      return { success: true, id: info.messageId };

    } else if (emailProvider === 'Resend') {
      const { data, error } = await emailService.emails.send({
        from: `${CONFIG.EMAIL_FROM_NAME} <${CONFIG.EMAIL_FROM}>`,
        to: [to],
        subject: subject,
        html: html,
      });

      if (error) {
        console.error(`❌ [Resend] Error:`, error);
        throw error;
      }

      console.log(`✅ [Resend] Email enviado a: ${to}`);
      return { success: true, id: data.id };
    }
  } catch (error) {
    console.error(`❌ Error enviando email a ${to}:`, error.message);
    throw error;
  }
};

// Helper para enviar emails con attachments
const sendEmailWithAttachments = async ({ to, subject, html, attachments }) => {
  if (!emailService) {
    throw new Error('Servicio de email no configurado');
  }

  try {
    if (emailProvider === 'Gmail') {
      const nodemailerAttachments = await Promise.all(
        attachments.map(async (file) => ({
          filename: file.filename,
          path: file.path,
          cid: file.cid
        }))
      );

      const info = await emailService.sendMail({
        from: `"${CONFIG.EMAIL_FROM_NAME}" <${CONFIG.EMAIL_USER}>`,
        to: to,
        subject: subject,
        html: html,
        attachments: nodemailerAttachments
      });

      console.log(`✅ [Gmail] Email con attachments enviado a: ${to}`);
      return { success: true, id: info.messageId };

    } else if (emailProvider === 'Resend') {
      const resendAttachments = await Promise.all(
        attachments.map(async (file) => {
          const content = await fs.readFile(file.path);
          return {
            filename: file.filename,
            content: content.toString('base64'),
          };
        })
      );

      const { data, error } = await emailService.emails.send({
        from: `${CONFIG.EMAIL_FROM_NAME} <${CONFIG.EMAIL_FROM}>`,
        to: [to],
        subject: subject,
        html: html,
        attachments: resendAttachments
      });

      if (error) {
        console.error(`❌ [Resend] Error:`, error);
        throw error;
      }

      console.log(`✅ [Resend] Email con attachments enviado a: ${to}`);
      return { success: true, id: data.id };
    }
  } catch (error) {
    console.error(`❌ Error enviando email con attachments a ${to}:`, error.message);
    throw error;
  }
};

// ===== Middleware de autenticación =====
function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const token = authHeader.split(' ')[1];
  if (!token || !token.startsWith('admin-token-')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// ============= RUTAS DEL CLIENTE =============

app.post('/api/subscribe', async (req, res) => {
  try {
    const { email: emailAddress } = req.body;

    if (!emailAddress || !emailAddress.includes('@')) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    // Incrementar clicks
    const stats = await getStats();
    if (useMongoDB) {
      stats.totalClicks++;
    } else {
      stats.totalClicks++;
    }

    // Verificar si ya existe
    const existingEmail = await findEmail(emailAddress);

    if (existingEmail) {
      await saveStats(stats);
      return res.json({
        exists: true,
        message: 'Este email ya está registrado',
        email: emailAddress
      });
    }

    // Agregar nuevo email
    const today = new Date().toISOString().split('T')[0];
    if (useMongoDB) {
      const dayCount = stats.emailsByDay.get(today) || 0;
      stats.emailsByDay.set(today, dayCount + 1);
      stats.totalEmails++;
    } else {
      stats.emailsByDay[today] = (stats.emailsByDay[today] || 0) + 1;
      stats.totalEmails++;
    }

    await createEmail(emailAddress);
    await saveStats(stats);

    console.log(`📊 Nuevo email registrado: ${emailAddress}`);

    res.json({
      success: true,
      message: 'Email registrado exitosamente',
      email: emailAddress
    });

  } catch (error) {
    console.error('❌ Error en subscribe:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/verify-email', async (req, res) => {
  try {
    const { email: emailAddress } = req.body;

    const emailRecord = await findEmail(emailAddress);
    if (!emailRecord) {
      return res.status(404).json({ error: 'Email no encontrado' });
    }

    console.log(`📧 Enviando verificación a: ${emailAddress}`);

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d4a574;">¡Bienvenido!</h2>
        <p>Gracias por suscribirte a nuestras notificaciones.</p>
        <p>Tu email <strong>${emailAddress}</strong> ha sido registrado correctamente.</p>
        <p>Recibirás nuestras actualizaciones y eventos especiales.</p>
        <hr style="border: 1px solid #f0f0f0; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">Si no solicitaste esta suscripción, puedes ignorar este email.</p>
      </div>
    `;

    await sendEmail({
      to: emailAddress,
      subject: 'Verifica tu suscripción - NOTI Demo',
      html: htmlContent
    });

    // Marcar como verificado
    emailRecord.verified = true;
    if (useMongoDB) {
      await emailRecord.save();
    } else {
      await saveDataToJSON();
    }

    res.json({
      success: true,
      message: 'Email de verificación enviado correctamente'
    });

  } catch (error) {
    console.error('❌ Error enviando verificación:', error);

    let errorMessage = 'Error al enviar email de verificación';
    if (error.message && error.message.includes('not configured')) {
      errorMessage = 'Servicio de email no configurado. Contacta al administrador.';
    }

    res.status(500).json({
      error: errorMessage,
      details: CONFIG.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============= RUTAS DEL ADMINISTRADOR =============

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;

  if (email === CONFIG.ADMIN_EMAIL && password === CONFIG.ADMIN_PASSWORD) {
    res.json({
      success: true,
      token: 'admin-token-' + Date.now()
    });
  } else {
    res.status(401).json({ error: 'Credenciales incorrectas' });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const stats = await getStats();
    const emails = await getAllEmails();

    // Convertir datos para el chart
    let chartData;
    if (useMongoDB) {
      chartData = Array.from(stats.emailsByDay.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    } else {
      chartData = Object.entries(stats.emailsByDay)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    const verifiedCount = await countEmails({ verified: true });
    const unverifiedCount = await countEmails({ verified: false });

    res.json({
      totalClicks: stats.totalClicks,
      totalEmails: stats.totalEmails,
      verifiedEmails: verifiedCount,
      unverifiedEmails: unverifiedCount,
      chartData,
      recentEmails: emails.slice(0, 10)
    });
  } catch (error) {
    console.error('❌ Error obteniendo stats:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

app.post('/api/admin/send-broadcast', adminAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { subject, message } = req.body;
    const images = req.files || [];

    if (!subject || !message) {
      return res.status(400).json({ error: 'Asunto y mensaje son requeridos' });
    }

    const totalEmails = await countEmails();
    if (totalEmails === 0) {
      return res.status(400).json({ error: 'No hay emails registrados' });
    }

    console.log(`📧 Iniciando envío masivo a ${totalEmails} suscriptores`);

    const attachments = images.map((file, index) => ({
      path: file.path,
      filename: file.originalname,
      cid: `image${index}`
    }));

    let imagesHTML = '';
    if (emailProvider === 'Gmail') {
      images.forEach((file, index) => {
        imagesHTML += `<img src="cid:image${index}" style="max-width: 100%; height: auto; margin: 10px 0;" alt="Imagen ${index + 1}">`;
      });
    } else if (images.length > 0) {
      imagesHTML = `<p style="color: #666; font-size: 14px; margin-top: 20px;"><em>📎 Este email incluye ${images.length} imagen(es) adjunta(s)</em></p>`;
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #d4a574 0%, #c89b68 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">${subject}</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="color: #333; line-height: 1.6; white-space: pre-wrap;">${message}</p>
          ${imagesHTML}
        </div>
        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>Recibiste este email porque te suscribiste a nuestras notificaciones.</p>
          <p style="font-size: 10px; margin-top: 10px;">Enviado con ${emailProvider}</p>
        </div>
      </div>
    `;

    let successCount = 0;
    let failedEmails = [];

    const allEmails = await getAllEmails();

    for (const record of allEmails) {
      try {
        if (attachments.length > 0) {
          await sendEmailWithAttachments({
            to: record.email,
            subject: subject,
            html: htmlContent,
            attachments: attachments
          });
        } else {
          await sendEmail({
            to: record.email,
            subject: subject,
            html: htmlContent
          });
        }
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        failedEmails.push(record.email);
        console.error(`❌ Error enviando a ${record.email}:`, error.message);
      }
    }

    console.log(`\n📊 Resultado del envío masivo:`);
    console.log(`   Exitosos: ${successCount}/${totalEmails}`);
    console.log(`   Fallidos: ${failedEmails.length}`);

    res.json({
      success: true,
      message: `Email enviado a ${successCount} de ${totalEmails} suscriptores`,
      count: successCount,
      failed: failedEmails.length,
      failedEmails: failedEmails
    });

  } catch (error) {
    console.error('❌ Error en broadcast:', error);
    res.status(500).json({
      error: 'Error al enviar emails masivos',
      details: CONFIG.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/api/admin/emails', adminAuth, async (req, res) => {
  try {
    const emails = await getAllEmails();
    res.json({ emails });
  } catch (error) {
    console.error('❌ Error obteniendo emails:', error);
    res.status(500).json({ error: 'Error obteniendo emails' });
  }
});

app.delete('/api/admin/emails/:email', adminAuth, async (req, res) => {
  try {
    const { email: emailAddress } = req.params;

    const deleted = await deleteEmail(emailAddress);

    if (deleted) {
      const stats = await getStats();
      stats.totalEmails = Math.max(0, stats.totalEmails - 1);
      await saveStats(stats);

      res.json({ success: true, message: 'Email eliminado' });
    } else {
      res.status(404).json({ error: 'Email no encontrado' });
    }
  } catch (error) {
    console.error('❌ Error eliminando email:', error);
    res.status(500).json({ error: 'Error eliminando email' });
  }
});

// Endpoint de prueba
app.post('/api/test-email', adminAuth, async (req, res) => {
  try {
    const testEmail = req.body.email || (emailProvider === 'Gmail' ? CONFIG.EMAIL_USER : 'delivered@resend.dev');

    console.log(`🧪 Enviando email de prueba a: ${testEmail}`);

    const result = await sendEmail({
      to: testEmail,
      subject: 'Email de Prueba - NOTI Demo',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #d4a574;">✅ Email de Prueba</h2>
          <p>Si recibes este email, significa que <strong>${emailProvider}</strong> está funcionando correctamente.</p>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
          <p><strong>Servicio:</strong> ${emailProvider}</p>
          <p><strong>Modo:</strong> ${CONFIG.NODE_ENV}</p>
          <p><strong>Base de datos:</strong> ${useMongoDB ? 'MongoDB (persistente)' : 'Archivos JSON (local)'}</p>
        </div>
      `
    });

    res.json({
      success: true,
      message: 'Email de prueba enviado correctamente',
      provider: emailProvider,
      emailId: result.id
    });

  } catch (error) {
    console.error('❌ Error en email de prueba:', error);
    res.status(500).json({
      error: 'Error al enviar email de prueba',
      details: error.message
    });
  }
});

// Ruta de health check
app.get('/health', async (req, res) => {
  const dbStatus = useMongoDB ?
    (mongoose.connection.readyState === 1 ? 'connected' : 'disconnected') :
    'file-based';

  const emailCount = await countEmails();

  res.json({
    status: 'ok',
    emailProvider: emailProvider,
    emailConfigured: !!emailService,
    database: useMongoDB ? 'MongoDB' : 'JSON Files',
    databaseStatus: dbStatus,
    mode: CONFIG.NODE_ENV,
    emailsCount: emailCount,
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
const startServer = async () => {
  // Cargar datos desde JSON si estamos en modo local
  if (!useMongoDB) {
    await loadDataFromJSON();
  }

  // Forzamos el host '0.0.0.0' para que escuche en toda la red local
  app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   🚀 SERVIDOR NEWSLETTER INICIADO     ║');
    console.log('╚════════════════════════════════════════╝');

    console.log(`\n📍 Local:   http://localhost:${CONFIG.PORT}/`);

    // Detectar y mostrar IPs de la red local
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        // Saltamos las direcciones IPv6 y las internas (127.0.0.1)
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`➜  Network: http://${net.address}:${CONFIG.PORT}/`);
        }
      }
    }

    console.log(`\n🌐 Frontend: ${CONFIG.FRONTEND_URL}`);
    console.log(`📧 Provider: ${emailProvider}`);
    console.log(`🗄️  Database: ${useMongoDB ? 'MongoDB (persistente)' : 'Archivos JSON (local)'}`);
    console.log(`🔧 Modo:     ${CONFIG.NODE_ENV}`);
    console.log(`👤 Admin:    ${CONFIG.ADMIN_EMAIL}\n`);
  });
};

startServer();
