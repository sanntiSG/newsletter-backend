// src/pages/AdminPanel.jsx
import React, { useState, useEffect } from 'react';
import {
  LogIn, Mail, TrendingUp, Users, CheckCircle, XCircle,
  Send, Image, Trash2, BarChart3, Calendar
} from 'lucide-react';

// ============= CONFIGURACIÓN - EDITAR AQUÍ =============
const API_URL = import.meta.env.VITE_API_URL || 'https://newsletter-backend-2iby.onrender.com';
// ======================================================

const AdminPanel = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('admin_token') || '');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [stats, setStats] = useState(null);
  const [emailList, setEmailList] = useState([]);
  const [subject, setSubject] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [images, setImages] = useState([]);
  const [sending, setSending] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });

  const showNotification = (message, type = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => setNotification({ show: false, message: '', type: '' }), 3500);
  };

  // ----- Auth helpers -----
  const saveToken = (t) => {
    setToken(t);
    localStorage.setItem('admin_token', t);
    setIsLoggedIn(true);
  };

  const doLogout = (msg) => {
    setToken('');
    localStorage.removeItem('admin_token');
    setIsLoggedIn(false);
    setStats(null);
    setEmailList([]);
    if (msg) showNotification(msg, 'error');
  };

  // ----- API call helpers with auth header -----
  const authHeaders = (extra = {}) => {
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra
    };
  };

  const fetchJson = async (url, opts = {}) => {
    const res = await fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(opts.headers || {}),
      }
    });
    // handle 401 centrally
    if (res.status === 401) {
      doLogout('Sesión expirada. Por favor ingresa de nuevo.');
      throw new Error('No autorizado');
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };

  // ----- Login -----
  const handleLogin = async () => {
    try {
      const { ok, data } = await fetchJson(`${API_URL}/api/admin/login`, {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      if (ok && data.success && data.token) {
        saveToken(data.token);
        setLoginEmail(''); setLoginPassword('');
        await loadStats(data.token);
        await loadEmails(data.token);
        showNotification('Sesión iniciada correctamente', 'success');
      } else {
        showNotification(data.error || 'Credenciales incorrectas', 'error');
      }
    } catch (err) {
      // fetchJson ya hace logout si 401
      if (err.message !== 'No autorizado') showNotification('Error al conectar con el servidor', 'error');
    }
  };

  // ----- Load stats & emails (send auth header) -----
  const loadStats = async (t = token) => {
    try {
      const headers = t ? { Authorization: `Bearer ${t}` } : {};
      const res = await fetch(`${API_URL}/api/admin/stats`, { headers });
      if (res.status === 401) return doLogout('No autorizado');
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    }
  };

  const loadEmails = async (t = token) => {
    try {
      const headers = t ? { Authorization: `Bearer ${t}` } : {};
      const res = await fetch(`${API_URL}/api/admin/emails`, { headers });
      if (res.status === 401) return doLogout('No autorizado');
      const data = await res.json();
      setEmailList(data.emails || []);
    } catch (error) {
      console.error('Error cargando emails:', error);
    }
  };

  // ----- Images / broadcast -----
  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length + images.length > 5) {
      showNotification('Máximo 5 imágenes permitidas', 'error');
      return;
    }
    setImages([...images, ...files]);
  };

  const removeImage = (index) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const handleSendBroadcast = async () => {
    if (!subject || !broadcastMessage) {
      showNotification('Asunto y mensaje son requeridos', 'error');
      return;
    }

    setSending(true);
    try {
      const formData = new FormData();
      formData.append('subject', subject);
      formData.append('message', broadcastMessage);
      images.forEach(image => formData.append('images', image));

      const res = await fetch(`${API_URL}/api/admin/send-broadcast`, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (res.status === 401) return doLogout('No autorizado');

      const data = await res.json();
      if (res.ok && data.success) {
        showNotification(`Email enviado a ${data.count} suscriptores`, 'success');
        setSubject('');
        setBroadcastMessage('');
        setImages([]);
        loadStats();
      } else {
        showNotification(data.error || 'Error al enviar emails', 'error');
      }
    } catch (error) {
      console.error(error);
      showNotification('Error al enviar broadcast', 'error');
    } finally {
      setSending(false);
    }
  };

  // ----- Delete email -----
  const handleDeleteEmail = async (email) => {
    if (!confirm(`¿Eliminar ${email}?`)) return;

    try {
      const res = await fetch(`${API_URL}/api/admin/emails/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.status === 401) return doLogout('No autorizado');
      if (res.ok) {
        showNotification('Email eliminado', 'success');
        loadEmails();
        loadStats();
      } else {
        const data = await res.json().catch(()=>({}));
        showNotification(data.error || 'Error al eliminar email', 'error');
      }
    } catch (error) {
      console.error(error);
      showNotification('Error al eliminar email', 'error');
    }
  };

  // ----- Effect: on token change, load data -----
  useEffect(() => {
    if (token) {
      setIsLoggedIn(true);
      loadStats();
      loadEmails();
      const interval = setInterval(loadStats, 30000);
      return () => clearInterval(interval);
    } else {
      setIsLoggedIn(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ----- UI -----
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#faf8f5] to-[#f5f0e8] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="bg-gradient-to-r from-[#d4a574] to-[#c89b68] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <LogIn className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Panel Administrativo</h1>
            <p className="text-gray-600 mt-2">Ingresa tus credenciales</p>
          </div>

          <div className="space-y-4">
            <input
              type="email"
              placeholder="Email de administrador"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#d4a574] focus:outline-none transition-colors"
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#d4a574] focus:outline-none transition-colors"
            />
            <button
              onClick={handleLogin}
              className="w-full bg-gradient-to-r from-[#d4a574] to-[#c89b68] text-white py-3 rounded-xl font-semibold hover:shadow-lg transition-all"
            >
              Iniciar Sesión
            </button>
            <p className="text-xs text-gray-500 mt-2">Usa las credenciales definidas en las variables de entorno del backend.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#faf8f5] to-[#f5f0e8] p-4 sm:p-6 lg:p-8">
      {notification.show && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-xl shadow-lg ${notification.type === 'error' ? 'bg-red-500' : 'bg-green-500'} text-white font-medium`}>
          {notification.message}
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">Panel Administrativo</h1>
            <p className="text-gray-600">Gestiona suscriptores y envía campañas</p>
          </div>
          <div>
            <button onClick={() => { doLogout(); showNotification('Sesión cerrada', 'success'); }} className="px-3 py-2 border rounded">Cerrar sesión</button>
          </div>
        </div>

        {/* --- Estadísticas y resto del UI (igual que tu versión, usando stats, emailList, etc) --- */}

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-2xl p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-blue-100 p-3 rounded-xl">
                  <TrendingUp className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm text-gray-500">Total</span>
              </div>
              <h3 className="text-3xl font-bold text-gray-800">{stats.totalClicks}</h3>
              <p className="text-gray-600 text-sm mt-1">Clicks totales</p>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-green-100 p-3 rounded-xl">
                  <Users className="w-6 h-6 text-green-600" />
                </div>
                <span className="text-sm text-gray-500">Activos</span>
              </div>
              <h3 className="text-3xl font-bold text-gray-800">{stats.totalEmails}</h3>
              <p className="text-gray-600 text-sm mt-1">Suscriptores</p>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-purple-100 p-3 rounded-xl">
                  <CheckCircle className="w-6 h-6 text-purple-600" />
                </div>
                <span className="text-sm text-gray-500">Verificados</span>
              </div>
              <h3 className="text-3xl font-bold text-gray-800">{stats.verifiedEmails}</h3>
              <p className="text-gray-600 text-sm mt-1">Emails verificados</p>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="bg-amber-100 p-3 rounded-xl">
                  <XCircle className="w-6 h-6 text-amber-600" />
                </div>
                <span className="text-sm text-gray-500">Pendientes</span>
              </div>
              <h3 className="text-3xl font-bold text-gray-800">{stats.unverifiedEmails}</h3>
              <p className="text-gray-600 text-sm mt-1">Sin verificar</p>
            </div>
          </div>
        )}

        {/* --- Chart & recent emails --- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <BarChart3 className="w-6 h-6 text-[#d4a574]" />
              <h2 className="text-2xl font-bold text-gray-800">Suscripciones por día</h2>
            </div>
            {stats?.chartData && stats.chartData.length > 0 ? (
              <div className="space-y-3">
                {stats.chartData.slice(-7).map((item, index) => (
                  <div key={index} className="flex items-center gap-4">
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-600">{new Date(item.date).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <div className="flex-1 bg-gray-100 rounded-full h-8 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-[#d4a574] to-[#c89b68] h-full rounded-full flex items-center justify-end pr-3"
                        style={{ width: `${(item.count / Math.max(...stats.chartData.map(d => d.count))) * 100}%` }}
                      >
                        <span className="text-white text-sm font-semibold">{item.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No hay datos todavía</p>
            )}
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <Mail className="w-6 h-6 text-[#d4a574]" />
              <h2 className="text-2xl font-bold text-gray-800">Emails recientes</h2>
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {stats?.recentEmails && stats.recentEmails.length > 0 ? (
                stats.recentEmails.map((email, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      {email.verified ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-gray-400" />
                      )}
                      <span className="text-sm text-gray-700">{email.email}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteEmail(email.email)}
                      className="text-red-500 hover:text-red-700 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-8">No hay emails registrados</p>
              )}
            </div>
          </div>
        </div>

        {/* --- Broadcast form --- */}
        <div className="bg-white rounded-2xl p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <Send className="w-6 h-6 text-[#d4a574]" />
            <h2 className="text-2xl font-bold text-gray-800">Crear Campaña</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Asunto del email</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ej: Nueva colección disponible"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#d4a574] focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mensaje</label>
              <textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Escribe tu mensaje aquí..."
                rows="8"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-[#d4a574] focus:outline-none transition-colors resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Imágenes (opcional, máximo 5)</label>
              <div className="space-y-4">
                <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-[#d4a574] transition-colors">
                  <Image className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-600">Seleccionar imágenes</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </label>

                {images.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                    {images.map((image, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={URL.createObjectURL(image)}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-24 object-cover rounded-xl"
                        />
                        <button
                          onClick={() => removeImage(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleSendBroadcast}
              disabled={sending || !subject || !broadcastMessage}
              className="w-full bg-gradient-to-r from-[#d4a574] to-[#c89b68] text-white py-4 px-6 rounded-xl font-semibold text-lg hover:shadow-lg transform hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Enviando a {stats?.totalEmails || 0} suscriptores...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Enviar Campaña a {stats?.totalEmails || 0} suscriptores
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
