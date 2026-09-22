import { AlertTriangle, ClipboardCheck, Hospital, PhoneCall, ShieldAlert, UserRoundCheck } from 'lucide-react';
import './emergency-protocol.css';

export default function EmergencyProtocol({ doctorName, institution }: { doctorName: string; institution: string }) {
  return <section className="rtep-root" aria-label="Emergency protocol">
    <header className="rtep-header">
      <div><span className="rtep-eyebrow">DOCTOR PORTAL · EMERGENCY PROTOCOL</span><h1>Emergency protocol</h1>
        <p>{institution || 'Your facility'} · Follow the facility's approved emergency-response policy and escalation chain.</p></div>
      <div className="rtep-badge"><ShieldAlert size={19}/> Immediate-use checklist</div>
    </header>

    <div className="rtep-alert"><AlertTriangle size={21}/><div><strong>For an active emergency</strong>
      <p>Use your facility's emergency response system immediately. RTTRACK is a record and workflow tool; it does not dispatch emergency services.</p></div></div>

    <div className="rtep-grid">
      <section className="rtep-card"><span>01</span><Hospital size={22}/><h2>Activate facility response</h2>
        <ul><li>Follow the hospital's established emergency-response procedure.</li>
          <li>Identify the patient's current location and immediate care area.</li>
          <li>Do not delay the facility response while documenting in RTTRACK.</li></ul></section>

      <section className="rtep-card"><span>02</span><UserRoundCheck size={22}/><h2>Identify and hand over</h2>
        <ul><li>Confirm the patient's identity using the facility's standard identifiers.</li>
          <li>Give the responding team the relevant treatment context available in the clinical record.</li>
          <li>Escalate to the responsible radiation oncology / treating team according to local policy.</li></ul></section>

      <section className="rtep-card"><span>03</span><PhoneCall size={22}/><h2>Facility contacts</h2>
        <dl><div><dt>Emergency switchboard</dt><dd>Use facility-configured contact</dd></div>
          <div><dt>Radiation oncology / on-call team</dt><dd>Use facility-configured contact</dd></div>
          <div><dt>External emergency service</dt><dd>Use the facility-approved service</dd></div></dl></section>

      <section className="rtep-card"><span>04</span><ClipboardCheck size={22}/><h2>Document and close the loop</h2>
        <ul><li>Record the event time, location, people contacted and actions taken in the appropriate clinical system.</li>
          <li>Complete the facility's incident or safety reporting workflow when required.</li>
          <li>Confirm handover to the responsible team before leaving the event unresolved.</li></ul></section>
    </div>

    <footer className="rtep-footer">Protocol opened by: <strong>{doctorName}</strong> · Facility: <strong>{institution || 'Not recorded'}</strong></footer>
  </section>;
}
