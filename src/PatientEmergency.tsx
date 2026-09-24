import { AlertTriangle, HeartPulse, PhoneCall, Stethoscope } from 'lucide-react';
import './patient-emergency.css';

export default function PatientEmergency({ onNavigate }: { onNavigate: (destination: string) => void }) {
  return <section className="rtpe-root" aria-labelledby="rtpe-title">
    <header><span className="rtpe-eyebrow">PATIENT PORTAL · EMERGENCY</span><h1 id="rtpe-title">Report emergency</h1>
      <p>Use your local emergency service or your hospital's emergency pathway for urgent help.</p></header>

    <div className="rtpe-alert"><AlertTriangle size={23}/><div><strong>RTTRACK does not dispatch emergency services.</strong>
      <p>If you believe you are experiencing an emergency, seek immediate help through your local emergency service or hospital. Do not wait for a response inside RTTRACK.</p></div></div>

    <div className="rtpe-grid">
      <article><PhoneCall size={24}/><h2>Get urgent help</h2><p>Call the emergency service used in your location or go to the nearest appropriate emergency facility.</p></article>
      <article><Stethoscope size={24}/><h2>Contact my care team</h2><p>Open your RTTRACK connections to identify your connected care team.</p><button type="button" onClick={() => onNavigate('Connections')}>Open care team</button></article>
      <article><HeartPulse size={24}/><h2>Record symptoms</h2><p>After urgent help is already being handled, you can record symptoms in your RTTRACK symptom journal.</p><button type="button" onClick={() => onNavigate('Symptoms')}>Open symptoms</button></article>
      <article><Stethoscope size={24}/><h2>Review treatment</h2><p>Open your treatment page to review the treatment and appointment information already recorded for your account.</p><button type="button" onClick={() => onNavigate('Treatment')}>Open treatment</button></article>
    </div>
  </section>;
}
