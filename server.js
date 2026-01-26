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

// ===== CORS mejorado (permitir Netlify y localhost) =====
const allowedOrigins = [
  CONFIG.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  }
});

// ========== CONFIGURACIÓN MEJORADA DE NODEMAILER ==========
// IMPORTANTE: El App Password NO debe tener espacios
const cleanPassword = CONFIG.EMAIL_PASSWORD ? CONFIG.EMAIL_PASSWORD.replace(/\s/g, '') : '';

const transporter = nodemailer.createTransport({
  service: 'gmail', // Usar 'service' es más confiable que host/port
  auth: {
    user: CONFIG.EMAIL_USER,
    pass: cleanPassword
  },
  // Opciones adicionales para mejor debugging
  tls: {
    rejectUnauthorized: false
  }
});

// Mostrar info de configuración
console.log('\n🔧 CONFIGURACIÓN DE EMAIL:');
console.log('   Email:', CONFIG.EMAIL_USER || '❌ NO CONFIGURADO');
console.log('   Password configurado:', cleanPassword ? '✅ SÍ' : '❌ NO');
console.log('   Password length:', cleanPassword ? cleanPassword.length : 0);

// Verificar transporter al inicio con mejor manejo de errores
const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Configuración de email verificada correctamente');
    console.log('   Servidor SMTP: smtp.gmail.com');
    console.log('   Usuario:', CONFIG.EMAIL_USER);
    return true;
  } catch (error) {
    console.error('\n❌ ERROR EN CONFIGURACIÓN DE EMAIL:');
    console.error('   Mensaje:', error.message);
    
    // Diagnóstico específico de errores comunes
    if (error.message.includes('Invalid login')) {
      console.error('\n💡 SOLUCIÓN:');
      console.error('   1. Verifica que EMAIL_USER sea correcto');
      console.error('   2. Genera un nuevo App Password en:');
      console.error('      https://myaccount.google.com/apppasswords');
      console.error('   3. Copia el password SIN espacios');
      console.error('   4. Asegúrate de tener verificación en 2 pasos activada');
    } else if (error.message.includes('EAUTH')) {
      console.error('\n💡 SOLUCIÓN:');
      console.error('   1. El App Password puede estar incorrecto');
      console.error('   2. Verifica que no tenga espacios');
      console.error('   3. Regenera el App Password si es necesario');
    }
    
    return false;
  }
};

// ===== Middleware de autenticación para endpoints admin =====
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
    console.log(`📊 Datos cargados: ${emailsDB.length} emails registrados`);
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

    statsDB.totalClicks++;

    const existingEmail = emailsDB.find(e => e.email === email);

    if (existingEmail) {
      return res.json({
        exists: true,
        message: 'Este email ya está registrado',
        email
      });
    }

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

// Enviar email de verificación - CON MEJOR MANEJO DE ERRORES
app.post('/api/verify-email', async (req, res) => {
  try {
    const { email } = req.body;

    const emailRecord = emailsDB.find(e => e.email === email);
    if (!emailRecord) {
      return res.status(404).json({ error: 'Email no encontrado' });
    }

    console.log(`📧 Intentando enviar verificación a: ${email}`);

    const mailOptions = {
      from: `"Newsletter Demo" <${CONFIG.EMAIL_USER}>`, // Nombre + email
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

    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email enviado exitosamente');
    console.log('   Message ID:', info.messageId);
    console.log('   Response:', info.response);

    emailRecord.verified = true;
    await saveData();

    res.json({
      success: true,
      message: 'Email de verificación enviado correctamente'
    });

  } catch (error) {
    console.error('❌ ERROR al enviar email de verificación:');
    console.error('   Tipo:', error.name);
    console.error('   Mensaje:', error.message);
    console.error('   Code:', error.code);
    
    // Respuesta más específica según el error
    let errorMessage = 'Error al enviar email de verificación';
    
    if (error.message.includes('Invalid login')) {
      errorMessage = 'Error de autenticación del servidor de email. Contacta al administrador.';
    } else if (error.code === 'EAUTH') {
      errorMessage = 'Credenciales de email incorrectas. Contacta al administrador.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'No se pudo conectar al servidor de email. Intenta de nuevo más tarde.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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
app.get('/api/admin/stats', adminAuth, (req, res) => {
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

// Enviar email masivo - CON MEJOR MANEJO DE ERRORES
app.post('/api/admin/send-broadcast', adminAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { subject, message } = req.body;
    const images = req.files || [];

    if (!subject || !message) {
      return res.status(400).json({ error: 'Asunto y mensaje son requeridos' });
    }

    if (emailsDB.length === 0) {
      return res.status(400).json({ error: 'No hay emails registrados' });
    }

    console.log(`📧 Iniciando envío masivo a ${emailsDB.length} suscriptores`);

    const attachments = images.map((file, index) => ({
      filename: file.originalname,
      path: file.path,
      cid: `image${index}`
    }));

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

    // Enviar emails con manejo individual de errores
    let successCount = 0;
    let failedEmails = [];

    for (const record of emailsDB) {
      try {
        await transporter.sendMail({
          from: `"Newsletter Demo" <${CONFIG.EMAIL_USER}>`,
          to: record.email,
          subject: subject,
          html: htmlContent,
          attachments: attachments
        });
        successCount++;
        console.log(`✅ Enviado a: ${record.email}`);
      } catch (error) {
        failedEmails.push(record.email);
        console.error(`❌ Error enviando a ${record.email}:`, error.message);
      }
    }

    console.log(`\n📊 Resultado del envío masivo:`);
    console.log(`   Exitosos: ${successCount}/${emailsDB.length}`);
    console.log(`   Fallidos: ${failedEmails.length}`);

    if (failedEmails.length > 0) {
      console.log(`   Emails fallidos:`, failedEmails);
    }

    res.json({
      success: true,
      message: `Email enviado a ${successCount} de ${emailsDB.length} suscriptores`,
      count: successCount,
      failed: failedEmails.length,
      failedEmails: failedEmails
    });

  } catch (error) {
    console.error('❌ Error en broadcast:', error);
    res.status(500).json({ 
      error: 'Error al enviar emails masivos',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Obtener lista de emails
app.get('/api/admin/emails', adminAuth, (req, res) => {
  res.json({ emails: emailsDB });
});

// Eliminar email
app.delete('/api/admin/emails/:email', adminAuth, async (req, res) => {
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

// Endpoint de prueba de email
app.post('/api/test-email', adminAuth, async (req, res) => {
  try {
    const testEmail = req.body.email || CONFIG.EMAIL_USER;
    
    console.log(`🧪 Enviando email de prueba a: ${testEmail}`);
    
    const info = await transporter.sendMail({
      from: `"Newsletter Demo" <${CONFIG.EMAIL_USER}>`,
      to: testEmail,
      subject: 'Email de Prueba - Newsletter',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #d4a574;">✅ Email de Prueba</h2>
          <p>Si recibes este email, significa que la configuración está funcionando correctamente.</p>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
          <p><strong>Email de envío:</strong> ${CONFIG.EMAIL_USER}</p>
        </div>
      `
    });

    console.log('✅ Email de prueba enviado exitosamente');
    console.log('   Message ID:', info.messageId);
    
    res.json({
      success: true,
      message: 'Email de prueba enviado correctamente',
      messageId: info.messageId
    });

  } catch (error) {
    console.error('❌ Error en email de prueba:', error);
    res.status(500).json({
      error: 'Error al enviar email de prueba',
      details: error.message
    });
  }
});

// Iniciar servidor
loadData().then(async () => {
  // Verificar configuración de email antes de iniciar
  await verifyEmailConfig();
  
  app.listen(CONFIG.PORT, () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   🚀 SERVIDOR NEWSLETTER INICIADO     ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`\n📍 URL Backend:  https://newsletter-backend-2iby.onrender.com/`);
    console.log(`🌐 Frontend:     ${CONFIG.FRONTEND_URL}`);
    console.log(`📧 Email config: ${CONFIG.EMAIL_USER}`);
    console.log(`👤 Admin email:  ${CONFIG.ADMIN_EMAIL}`);
    console.log(`📊 Emails registrados: ${emailsDB.length}`);
    console.log(`✅ Total clicks: ${statsDB.totalClicks}\n`);
  });
});