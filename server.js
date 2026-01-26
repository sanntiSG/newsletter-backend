require('dotenv').config();

// ============= CONFIGURACIÓN - EDITAR AQUÍ =============
const CONFIG = {
  PORT: process.env.PORT || 5000,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5555',
  // Resend
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM || 'onboarding@resend.dev',
  EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'Newsletter Demo',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
};
// ======================================================

const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// ===== CORS mejorado =====
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

// ========== CONFIGURACIÓN DE RESEND ==========
let resend = null;

if (CONFIG.RESEND_API_KEY) {
  resend = new Resend(CONFIG.RESEND_API_KEY);
  console.log('✅ Resend configurado correctamente');
  console.log('   From Email:', CONFIG.EMAIL_FROM);
  console.log('   From Name:', CONFIG.EMAIL_FROM_NAME);
} else {
  console.error('❌ RESEND_API_KEY no configurado');
  console.error('💡 Obtén tu API Key en: https://resend.com/api-keys');
}

// Helper para enviar emails con Resend
const sendEmail = async ({ to, subject, html }) => {
  if (!resend) {
    throw new Error('Resend no está configurado. Verifica RESEND_API_KEY.');
  }

  try {
    const { data, error } = await resend.emails.send({
      from: `${CONFIG.EMAIL_FROM_NAME} <${CONFIG.EMAIL_FROM}>`,
      to: [to],
      subject: subject,
      html: html,
    });

    if (error) {
      console.error(`❌ Error de Resend:`, error);
      throw error;
    }

    console.log(`✅ Email enviado a: ${to}`);
    console.log(`   ID: ${data.id}`);
    return { success: true, id: data.id };
  } catch (error) {
    console.error(`❌ Error enviando email a ${to}:`, error.message);
    throw error;
  }
};

// Helper para enviar emails con attachments
const sendEmailWithAttachments = async ({ to, subject, html, attachments }) => {
  if (!resend) {
    throw new Error('Resend no está configurado. Verifica RESEND_API_KEY.');
  }

  try {
    // Convertir attachments a formato Resend
    const resendAttachments = await Promise.all(
      attachments.map(async (file) => {
        const content = await fs.readFile(file.path);
        return {
          filename: file.filename,
          content: content,
        };
      })
    );

    // Para emails con imágenes, usar attachments tradicionales
    // Resend no soporta CID embebido como Gmail, así que adjuntamos las imágenes
    const { data, error } = await resend.emails.send({
      from: `${CONFIG.EMAIL_FROM_NAME} <${CONFIG.EMAIL_FROM}>`,
      to: [to],
      subject: subject,
      html: html,
      attachments: resendAttachments,
    });

    if (error) {
      console.error(`❌ Error de Resend:`, error);
      throw error;
    }

    console.log(`✅ Email con attachments enviado a: ${to}`);
    console.log(`   ID: ${data.id}`);
    return { success: true, id: data.id };
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

// Base de datos en memoria
let emailsDB = [];
let statsDB = {
  totalClicks: 0,
  emailsByDay: {},
  totalEmails: 0,
  lastUpdated: new Date()
};

// Cargar datos
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

app.post('/api/verify-email', async (req, res) => {
  try {
    const { email } = req.body;

    const emailRecord = emailsDB.find(e => e.email === email);
    if (!emailRecord) {
      return res.status(404).json({ error: 'Email no encontrado' });
    }

    console.log(`📧 Enviando verificación a: ${email}`);

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d4a574;">¡Bienvenido!</h2>
        <p>Gracias por suscribirte a nuestras notificaciones.</p>
        <p>Tu email <strong>${email}</strong> ha sido registrado correctamente.</p>
        <p>Recibirás nuestras actualizaciones y eventos especiales.</p>
        <hr style="border: 1px solid #f0f0f0; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">Si no solicitaste esta suscripción, puedes ignorar este email.</p>
      </div>
    `;

    await sendEmail({
      to: email,
      subject: 'Verifica tu suscripción - Newsletter Demo',
      html: htmlContent
    });

    emailRecord.verified = true;
    await saveData();

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
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    // Preparar attachments
    const attachments = images.map((file) => ({
      path: file.path,
      filename: file.originalname,
    }));

    // HTML mejorado (sin CID, solo texto si hay imágenes)
    let imagesNote = '';
    if (images.length > 0) {
      imagesNote = `<p style="color: #666; font-size: 14px; margin-top: 20px;"><em>📎 Este email incluye ${images.length} imagen(es) adjunta(s)</em></p>`;
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #d4a574 0%, #c89b68 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">${subject}</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <p style="color: #333; line-height: 1.6; white-space: pre-wrap;">${message}</p>
          ${imagesNote}
        </div>
        <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
          <p>Recibiste este email porque te suscribiste a nuestras notificaciones.</p>
        </div>
      </div>
    `;

    let successCount = 0;
    let failedEmails = [];

    // Enviar a cada suscriptor
    for (const record of emailsDB) {
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
        
        // Pequeño delay para no sobrecargar la API (opcional)
        await new Promise(resolve => setTimeout(resolve, 100));
        
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

app.get('/api/admin/emails', adminAuth, (req, res) => {
  res.json({ emails: emailsDB });
});

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

// Endpoint de prueba
app.post('/api/test-email', adminAuth, async (req, res) => {
  try {
    const testEmail = req.body.email || 'delivered@resend.dev';
    
    console.log(`🧪 Enviando email de prueba a: ${testEmail}`);
    
    const result = await sendEmail({
      to: testEmail,
      subject: 'Email de Prueba - Newsletter Demo',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #d4a574;">✅ Email de Prueba</h2>
          <p>Si recibes este email, significa que <strong>Resend</strong> está funcionando correctamente.</p>
          <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
          <p><strong>Email de envío:</strong> ${CONFIG.EMAIL_FROM}</p>
          <p><strong>Servicio:</strong> Resend</p>
        </div>
      `
    });

    res.json({
      success: true,
      message: 'Email de prueba enviado correctamente',
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
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    resendConfigured: !!resend,
    emailsCount: emailsDB.length,
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
loadData().then(() => {
  app.listen(CONFIG.PORT, () => {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   🚀 SERVIDOR NEWSLETTER INICIADO     ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`\n📍 Backend:  https://newsletter-backend-2iby.onrender.com/`);
    console.log(`🌐 Frontend: ${CONFIG.FRONTEND_URL}`);
    console.log(`📧 Email:    ${CONFIG.EMAIL_FROM}`);
    console.log(`👤 Admin:    ${CONFIG.ADMIN_EMAIL}`);
    console.log(`📊 Emails:   ${emailsDB.length} registrados`);
    console.log(`✅ Clicks:   ${statsDB.totalClicks}`);
    console.log(`🔧 Resend:   ${resend ? 'Configurado ✅' : 'No configurado ❌'}\n`);
  });
});