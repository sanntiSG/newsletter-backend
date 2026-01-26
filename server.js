// backend/server.js
require('dotenv').config();

// ============= CONFIGURACIÓN - EDITAR AQUÍ =============
const CONFIG = {
  PORT: process.env.PORT || 5000,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5555',
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};

// ======================================================

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// Configuración de CORS para permitir peticiones desde Vite
app.use(cors({
  origin: CONFIG.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  }
});


const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true para 465
  auth: {
    user: CONFIG.EMAIL_USER,
    pass: CONFIG.EMAIL_PASSWORD // aquí va el App Password de Google
  }
});


// Base de datos en memoria
let emailsDB = [];
let statsDB = {
  totalClicks: 0,
  emailsByDay: {},
  totalEmails: 0,
  lastUpdated: new Date()
};

// Cargar datos si existen
const loadData = async () => {
  try {
    const emailsData = await fs.readFile('data/emails.json', 'utf8');
    const statsData = await fs.readFile('data/stats.json', 'utf8');
    emailsDB = JSON.parse(emailsData);
    statsDB = JSON.parse(statsData);
  } catch (error) {
    console.log('📝 Iniciando con base de datos vacía');
  }
};

// Guardar datos
const saveData = async () => {
  try {
    await fs.mkdir('data', { recursive: true });
    await fs.writeFile('data/emails.json', JSON.stringify(emailsDB, null, 2));
    await fs.writeFile('data/stats.json', JSON.stringify(statsDB, null, 2));
  } catch (error) {
    console.error('❌ Error guardando datos:', error);
  }
};

// ============= RUTAS DEL CLIENTE =============

// Registrar email
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    // Incrementar clicks
    statsDB.totalClicks++;

    // Verificar si ya existe
    const existingEmail = emailsDB.find(e => e.email === email);
    
    if (existingEmail) {
      return res.json({ 
        exists: true, 
        message: 'Este email ya está registrado',
        email 
      });
    }

    // Agregar nuevo email
    const today = new Date().toISOString().split('T')[0];
    statsDB.emailsByDay[today] = (statsDB.emailsByDay[today] || 0) + 1;
    statsDB.totalEmails++;

    emailsDB.push({
      email,
      subscribedAt: new Date().toISOString(),
      verified: false
    });

    await saveData();

    res.json({ 
      success: true, 
      message: 'Email registrado exitosamente',
      email 
    });

  } catch (error) {
    console.error('❌ Error en subscribe:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Enviar email de verificación
app.post('/api/verify-email', async (req, res) => {
  try {
    const { email } = req.body;

    const emailRecord = emailsDB.find(e => e.email === email);
    if (!emailRecord) {
      return res.status(404).json({ error: 'Email no encontrado' });
    }

    const mailOptions = {
      from: CONFIG.EMAIL_USER,
      to: email,
      subject: 'Verifica tu suscripción',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d4a574;">¡Bienvenido!</h2>
          <p>Gracias por suscribirte a nuestras notificaciones.</p>
          <p>Tu email <strong>${email}</strong> ha sido registrado correctamente.</p>
          <p>Recibirás nuestras actualizaciones y eventos especiales.</p>
          <hr style="border: 1px solid #f0f0f0; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">Si no solicitaste esta suscripción, puedes ignorar este email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    // Marcar como verificado
    emailRecord.verified = true;
    await saveData();

    res.json({ 
      success: true, 
      message: 'Email de verificación enviado' 
    });

  } catch (error) {
    console.error('❌ Error enviando verificación:', error);
    res.status(500).json({ error: 'Error al enviar email de verificación' });
  }
});

// ============= RUTAS DEL ADMINISTRADOR =============

// Login del admin
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

// Obtener estadísticas
app.get('/api/admin/stats', (req, res) => {
  const chartData = Object.entries(statsDB.emailsByDay).map(([date, count]) => ({
    date,
    count
  })).sort((a, b) => new Date(a.date) - new Date(b.date));

  res.json({
    totalClicks: statsDB.totalClicks,
    totalEmails: statsDB.totalEmails,
    verifiedEmails: emailsDB.filter(e => e.verified).length,
    unverifiedEmails: emailsDB.filter(e => !e.verified).length,
    chartData,
    recentEmails: emailsDB.slice(-10).reverse()
  });
});

// Enviar email masivo
app.post('/api/admin/send-broadcast', upload.array('images', 5), async (req, res) => {
  try {
    const { subject, message } = req.body;
    const images = req.files || [];

    if (!subject || !message) {
      return res.status(400).json({ error: 'Asunto y mensaje son requeridos' });
    }

    if (emailsDB.length === 0) {
      return res.status(400).json({ error: 'No hay emails registrados' });
    }

    // Preparar attachments para las imágenes
    const attachments = images.map((file, index) => ({
      filename: file.originalname,
      path: file.path,
      cid: `image${index}`
    }));

    // Generar HTML con imágenes embebidas
    let imagesHTML = '';
    images.forEach((file, index) => {
      imagesHTML += `<img src="cid:image${index}" style="max-width: 100%; height: auto; margin: 10px 0;" alt="Imagen ${index + 1}">`;
    });

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
        </div>
      </div>
    `;

    // Enviar a todos los emails
    const sendPromises = emailsDB.map(record => {
      return transporter.sendMail({
        from: CONFIG.EMAIL_USER,
        to: record.email,
        subject: subject,
        html: htmlContent,
        attachments: attachments
      });
    });

    await Promise.all(sendPromises);

    res.json({ 
      success: true, 
      message: `Email enviado a ${emailsDB.length} suscriptores`,
      count: emailsDB.length
    });

  } catch (error) {
    console.error('❌ Error enviando broadcast:', error);
    res.status(500).json({ error: 'Error al enviar emails masivos' });
  }
});

// Obtener lista de emails
app.get('/api/admin/emails', (req, res) => {
  res.json({ emails: emailsDB });
});

// Eliminar email
app.delete('/api/admin/emails/:email', async (req, res) => {
  const { email } = req.params;
  const index = emailsDB.findIndex(e => e.email === email);
  
  if (index !== -1) {
    emailsDB.splice(index, 1);
    statsDB.totalEmails--;
    await saveData();
    res.json({ success: true, message: 'Email eliminado' });
  } else {
    res.status(404).json({ error: 'Email no encontrado' });
  }
});

// Iniciar servidor
loadData().then(() => {
  app.listen(CONFIG.PORT, () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   🚀 SERVIDOR NEWSLETTER INICIADO     ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`\n📍 URL Backend:  http://localhost:${CONFIG.PORT}`);
    console.log(`🌐 Frontend:     ${CONFIG.FRONTEND_URL}`);
    console.log(`📧 Email config: ${CONFIG.EMAIL_USER}`);
    console.log(`👤 Admin email:  ${CONFIG.ADMIN_EMAIL}`);
    console.log(`📊 Emails registrados: ${emailsDB.length}`);
    console.log(`✅ Total clicks: ${statsDB.totalClicks}\n`);
  });
});