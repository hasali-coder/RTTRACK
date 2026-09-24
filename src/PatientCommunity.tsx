import { BookOpen, HeartPulse, ShieldCheck, Users } from 'lucide-react';
import './patient-community.css';

export default function PatientCommunity({ onNavigate }: { onNavigate: (destination: string) => void }) {
  return <section className="rtpc-root" aria-labelledby="rtpc-title">
    <header><span className="rtpc-eyebrow">PATIENT PORTAL · COMMUNITY</span><h1 id="rtpc-title">Community & support</h1>
      <p>Use your existing RTTRACK care and education spaces to stay informed and connected.</p></header>
    <div className="rtpc-grid">
      <article><Users size={24}/><h2>My care team</h2><p>Review the doctors connected to your RTTRACK account and manage your sharing permissions.</p><button type="button" onClick={() => onNavigate('Connections')}>Open care team</button></article>
      <article><BookOpen size={24}/><h2>Education library</h2><p>Read approved educational resources already available in RTTRACK.</p><button type="button" onClick={() => onNavigate('Education')}>Browse education</button></article>
      <article><HeartPulse size={24}/><h2>My symptom journal</h2><p>Review and add your own symptom entries, then control which connected doctors may view them.</p><button type="button" onClick={() => onNavigate('Symptoms')}>Open symptoms</button></article>
      <article><ShieldCheck size={24}/><h2>Privacy first</h2><p>RTTRACK does not expose your account to other patients. A peer-to-peer community feed should only be introduced with separate moderation, privacy and consent controls.</p></article>
    </div>
  </section>;
}
