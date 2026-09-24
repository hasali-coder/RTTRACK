import { useEffect, useRef } from 'react';
import { CircleHelp, X } from 'lucide-react';
import './patient-topbar-tools.css';

const faqs = [
  ['Where does my treatment information come from?', 'Treatment plans and fraction records shown in RTTRACK come from the records entered and published by your connected care team.'],
  ['Can I change my treatment plan?', 'No. The Patient Portal lets you view treatment information. Treatment-plan changes are handled by the responsible clinical team.'],
  ['Who can see my symptom entries?', 'Your symptom journal is private by default. You separately choose which active connected doctors may view those entries.'],
  ['How do treatment-record permissions work?', 'A patient controls treatment-record sharing for each care connection. Access can be withdrawn from the Connections page.'],
  ['Where can I manage reminders?', 'Open Reminders from the sidebar. Upcoming treatment sessions and your pending personal reminders also appear under the notification bell.'],
  ['What should I do in an emergency?', 'Use the Report Emergency page for guidance, but seek immediate help through your local emergency service or hospital. RTTRACK does not dispatch emergency services.'],
];

export default function PatientFaq({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return <dialog ref={dialogRef} className="rtpt-dialog" aria-labelledby="rtpt-faq-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="rtpt-shell">
      <div className="rtpt-head"><div><span>HELP CENTRE</span><h2 id="rtpt-faq-title"><CircleHelp size={20}/> Frequently asked questions</h2></div>
        <button type="button" aria-label="Close FAQ" onClick={onClose}><X size={19}/></button></div>
      <div className="rtpt-faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
    </div>
  </dialog>;
}
