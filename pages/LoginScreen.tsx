import React, { useState } from 'react';
import { LogIn, KeyRound, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LoginScreenProps {
  onLogin: (key: string) => void;
  error?: string | null;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, error }) => {
  const [keyInput, setKeyInput] = useState('');
  const [isHovering, setIsHovering] = useState(false);

  const handleRandomKey = () => {
    const randomKey = Array.from({ length: 4 }, () => Math.random().toString(36).substring(2, 6)).join('-');
    setKeyInput(randomKey);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyInput.trim().length > 0) {
      onLogin(keyInput.trim());
    }
  };

  return (
    <div className="relative min-h-screen bg-[#050505] flex items-center justify-center p-4 overflow-hidden font-sans">
      {/* Background ambient lighting */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary-600/10 blur-[120px] rounded-full pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative max-w-md w-full bg-gray-900/40 backdrop-blur-3xl border border-gray-800/50 rounded-3xl p-8 shadow-2xl z-10"
      >
        <div className="text-center mb-10">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="w-20 h-20 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-3xl mx-auto flex items-center justify-center mb-6 shadow-xl shadow-primary-500/20 rotate-3"
          >
            <KeyRound size={36} className="text-white -rotate-3" strokeWidth={1.5} />
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold text-white mb-3 tracking-tight"
          >
            Akses Rumah
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-gray-400 text-sm leading-relaxed px-4"
          >
            Gunakan kunci ID unik untuk masuk dan mensinkronisasikan ruang obrolan Anda di semua perangkat.
          </motion.p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-2xl text-sm font-medium"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 }}
          >
            <label className="block text-sm font-medium text-gray-300 mb-2 ml-1">Kunci Identifikasi</label>
            <div className="relative group">
              <input 
                type="text" 
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                placeholder="Misal: abcd-efgh-ijkl"
                className="w-full bg-gray-950/50 border border-gray-800 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-primary-500/60 focus:ring-4 focus:ring-primary-500/10 transition-all font-mono tracking-wider pl-14 placeholder:text-gray-700"
              />
              <div className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-primary-400 transition-colors">
                <KeyRound size={20} strokeWidth={2} />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3 flex items-center ml-1">
               <span className="w-1.5 h-1.5 rounded-full bg-gray-700 mr-2" />
               Hanya huruf, angka, strip, dan underscore
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="flex flex-col sm:flex-row gap-3 pt-2"
          >
            <button 
              type="button" 
              onClick={handleRandomKey}
              className="flex-1 px-5 py-4 rounded-2xl font-medium text-gray-300 bg-gray-800/40 hover:bg-gray-800/80 border border-gray-700/50 hover:border-gray-600 transition-all flex items-center justify-center gap-2 group"
            >
              <Sparkles size={18} className="text-gray-500 group-hover:text-primary-400 transition-colors" />
              <span>Buat Acak</span>
            </button>
            <button 
              type="submit" 
              disabled={keyInput.length < 3}
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
              className="flex-1 px-5 py-4 rounded-2xl font-semibold text-white bg-white/10 hover:bg-primary-600 border border-white/5 hover:border-primary-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed group relative overflow-hidden"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                Lanjut
                <motion.div 
                  animate={{ x: isHovering ? 4 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <LogIn size={18} strokeWidth={2.5} />
                </motion.div>
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-primary-600 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-0" />
            </button>
          </motion.div>
        </form>
      </motion.div>
    </div>
  );
};

export default LoginScreen;
