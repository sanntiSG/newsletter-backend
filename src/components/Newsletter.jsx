import React, { useState } from 'react';
import { Mail, Check, AlertCircle, Sparkles } from 'lucide-react';

// ============= CONFIGURACIÓN - EDITAR AQUÍ =============
const API_URL = 'http://localhost:5000'; // URL del backend
// ======================================================

const Newsletter = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [showVerification, setShowVerification] = useState(false);

  const handleSubmit = async () => {
    if (!email || !email.includes('@')) {
      setStatus('error');
      setMessage('Por favor ingresa un email válido');
      return;
    }

    setStatus('loading');

    try {
      const response = await fetch(`${API_URL}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (data.exists) {
        setStatus('exists');
        setMessage(data.message);
        setShowVerification(true);
      } else if (data.success) {
        setStatus('success');
        setMessage(data.message);
        setTimeout(() => {
          setEmail('');
          setStatus('idle');
          setMessage('');
        }, 3000);
      }
    } catch (error) {
      setStatus('error');
      setMessage('Error al conectar con el servidor');
    }
  };

  const handleVerification = async () => {
    setStatus('loading');
    
    try {
      const response = await fetch(`${API_URL}/api/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (data.success) {
        setStatus('success');
        setMessage('¡Email de verificación enviado! Revisa tu bandeja de entrada.');
        setShowVerification(false);
        setTimeout(() => {
          setEmail('');
          setStatus('idle');
          setMessage('');
        }, 4000);
      }
    } catch (error) {
      setStatus('error');
      setMessage('Error al enviar verificación');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="w-full bg-gradient-to-br from-[#faf8f5] to-[#f5f0e8] py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#d4a574] to-[#c89b68] px-8 py-12 text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-white/20 backdrop-blur-sm p-4 rounded-full">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              ¿Quieres recibir notificaciones?
            </h2>
            <p className="text-white/90 text-lg max-w-2xl mx-auto">
              Suscríbete a nuestro newsletter y mantente al día con nuestras novedades, eventos exclusivos y ofertas especiales.
            </p>
          </div>

          <div className="px-8 py-10">
            <div className="space-y-6">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-[#d4a574]" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="tu-email@ejemplo.com"
                  disabled={status === 'loading'}
                  className="w-full pl-12 pr-4 py-4 bg-[#faf8f5] border-2 border-[#e8dcc8] rounded-xl 
                           focus:border-[#d4a574] focus:outline-none focus:ring-2 focus:ring-[#d4a574]/20 
                           transition-all duration-200 text-gray-800 placeholder-gray-400
                           disabled:opacity-50 disabled:cursor-not-allowed text-base sm:text-lg"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={status === 'loading' || !email}
                className="w-full bg-gradient-to-r from-[#d4a574] to-[#c89b68] text-white py-4 px-6 
                         rounded-xl font-semibold text-lg hover:shadow-lg transform hover:scale-[1.02] 
                         transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                         disabled:transform-none flex items-center justify-center gap-2"
              >
                {status === 'loading' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Mail className="w-5 h-5" />
                    Suscribirme
                  </>
                )}
              </button>
            </div>

            {message && (
              <div className={`mt-6 p-4 rounded-xl flex items-start gap-3 ${
                status === 'success' ? 'bg-green-50 border-2 border-green-200' :
                status === 'exists' ? 'bg-amber-50 border-2 border-amber-200' :
                'bg-red-50 border-2 border-red-200'
              }`}>
                {status === 'success' && <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />}
                {status === 'exists' && <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
                {status === 'error' && <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />}
                
                <div className="flex-1">
                  <p className={`font-medium ${
                    status === 'success' ? 'text-green-800' :
                    status === 'exists' ? 'text-amber-800' :
                    'text-red-800'
                  }`}>
                    {message}
                  </p>
                  
                  {showVerification && (
                    <button
                      onClick={handleVerification}
                      disabled={status === 'loading'}
                      className="mt-3 text-sm font-medium text-[#d4a574] hover:text-[#c89b68] 
                               underline underline-offset-2 transition-colors disabled:opacity-50"
                    >
                      Enviar email de verificación
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex flex-wrap gap-6 justify-center text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#d4a574]" />
                  <span>Sin spam</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#d4a574]" />
                  <span>Cancela cuando quieras</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#d4a574]" />
                  <span>Contenido exclusivo</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Newsletter;