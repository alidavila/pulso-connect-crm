// api/welcome-email.js — Send welcome email to new leads
import nodemailer from 'nodemailer';

const WELCOME_SUBJECTS = {
  'AgentLink': '🚀 Bienvenido a AgentLink — Tu carrera impulsada por IA',
  'Veritas': '🔐 Bienvenido a Veritas — Tu identidad digital soberana',
  'Lucía': '💰 Bienvenida a Lucía — Tu CFO personal con IA',
  'Salenis': '🧬 Bienvenido a Salenis — Tu gemelo digital de salud',
  'Matarife': '🥩 Bienvenido a Matarife — La red de carnicerías inteligentes',
};

const WELCOME_BODY = (name, interest) => `Hola ${name || 'futuro co-creador'},

Gracias por registrarte en PulsoConnect${interest ? ` — nos alegra tu interés en ${interest}` : ''}.

Estamos construyendo agentes de IA que operan áreas reales de tu vida: finanzas, carrera profesional, identidad digital y salud. No vendemos humo — construimos productos que funcionan.

${interest ? getProductBlurb(interest) : getGeneralBlurb()}

⚠️ Acceso anticipado limitado
Estamos abriendo el acceso por orden de registro. Los primeros en entrar tendrán precio de co-creador (simbólico, solo cubrir costes) y serán los primeros en equity si el proyecto crece.

Cuando tu acceso esté listo, te enviaremos las instrucciones. Mientras tanto, síguenos en nuestro blog donde publicamos guías prácticas:

→ https://pulsoconnect.es/blog/

¿Preguntas? Responde a este email — te lee una persona real (Jesús, el fundador).

—
PulsoConnect
ali@pulsoconnect.es
https://pulsoconnect.es`;

function getProductBlurb(interest) {
  const blurbs = {
    'AgentLink': 'AgentLink automatiza tu presencia en LinkedIn: publicaciones, networking y oportunidades laborales — gestionado por un agente IA que entiende tus objetivos profesionales.',
    'Veritas': 'Veritas te da control total sobre tu identidad digital: KYC descentralizado, credenciales verificables y puntuación de confianza sin intermediarios.',
    'Lucía': 'Lucía es tu CFO personal con IA: conecta tus cuentas bancarias, analiza gastos, sigue deudas y proyecta tu futuro financiero.',
    'Salenis': 'Salenis es tu gemelo digital de salud: consolida tu historial médico, análisis de laboratorio y diagnósticos en un ecosistema inteligente.',
    'Matarife': 'Matarife conecta carnicerías locales con clientes usando logística inteligente e IA. Del mostrador al delivery inteligente.',
  };
  return blurbs[interest] || '';
}

function getGeneralBlurb() {
  return 'Nuestro ecosistema incluye Lucía (finanzas), AgentLink (carrera), Veritas (identidad), Salenis (salud) y Matarife (economía local). Todos conectados por Hermes, el agente que los orquesta.';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, email, interest } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const smtp = {
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true,
    auth: {
      user: process.env.SMTP_USER || 'ali@pulsoconnect.es',
      pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '',
    },
  };

  if (!smtp.auth.pass) {
    console.error('SMTP password not configured');
    return res.status(500).json({ error: 'Email not configured' });
  }

  try {
    const transporter = nodemailer.createTransport(smtp);
    const subject = WELCOME_SUBJECTS[interest] || '👋 Bienvenido a PulsoConnect';
    const body = WELCOME_BODY(name, interest);

    await transporter.sendMail({
      from: `"PulsoConnect" <${smtp.auth.user}>`,
      to: email,
      subject,
      text: body,
    });

    return res.json({ sent: true, to: email });
  } catch (e) {
    console.error('Email send error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
