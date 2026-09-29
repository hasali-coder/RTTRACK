import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { ChevronDown, KeyRound, LogOut, Save, ShieldCheck, UserRound } from 'lucide-react';
import { supabase } from './supabase';
import './doctor-profile.css';

type ProfileTab = 'profile' | 'security';

type DoctorProfileProps = {
  user: User;
  verifiedName: string;
  institution: string;
  registrationNumber: string;
  accountStatus: string;
  initialTab?: ProfileTab;
  onUserUpdated: (user: User) => void;
  onPasswordUpdated: () => void;
};

const metadataString = (user: User, key: string) => {
  const value: unknown = user.user_metadata?.[key];
  return typeof value === 'string' ? value : '';
};

export default function DoctorProfile({
  user, verifiedName, institution, registrationNumber, accountStatus,
  initialTab = 'profile', onUserUpdated, onPasswordUpdated,
}: DoctorProfileProps) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [displayName, setDisplayName] = useState(() => metadataString(user, 'rttrack_display_name') || verifiedName);
  const [phone, setPhone] = useState(() => metadataString(user, 'rttrack_phone'));
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [securityError, setSecurityError] = useState('');
  const [securityNotice, setSecurityNotice] = useState('');

  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => {
    setDisplayName(metadataString(user, 'rttrack_display_name') || verifiedName);
    setPhone(metadataString(user, 'rttrack_phone'));
  }, [user.id, user.user_metadata?.rttrack_display_name, user.user_metadata?.rttrack_phone, verifiedName]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || saving) return;
    const name = displayName.trim();
    const telephone = phone.trim();
    setProfileError('');
    setProfileNotice('');
    if (name.length < 2 || name.length > 90) {
      setProfileError('Display name must contain between 2 and 90 characters.');
      return;
    }
    if (telephone && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(telephone)) {
      setProfileError('Enter a valid phone number, including the country code if applicable.');
      return;
    }
    setSaving(true);
    try {
      // Cosmetic and contact information only; verified professional identity
      // remains in the administrator-controlled clinician application record.
      const { data, error } = await supabase.auth.updateUser({
        data: { rttrack_display_name: name, rttrack_phone: telephone },
      });
      if (error) throw error;
      if (!data.user) throw new Error('Supabase did not confirm the profile update.');
      onUserUpdated(data.user);
      setProfileNotice('Your account details have been updated.');
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || passwordBusy) return;
    setSecurityError('');
    setSecurityNotice('');
    if (!user.email) {
      setSecurityError('Your account email is unavailable. Contact an administrator.');
      return;
    }
    if (newPassword.length < 12) {
      setSecurityError('Use a new password of at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSecurityError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setSecurityError('Your new password must be different from your current password.');
      return;
    }
    setPasswordBusy(true);
    try {
      // Verify the existing password before allowing an in-session change.
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email, password: currentPassword,
      });
      if (verifyError) throw new Error('Current password could not be verified.');
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSecurityNotice('Password updated successfully.');
      onPasswordUpdated();
    } catch (caught) {
      setSecurityError(caught instanceof Error ? caught.message : 'Password could not be changed.');
    } finally {
      setPasswordBusy(false);
    }
  }

  const shownName = metadataString(user, 'rttrack_display_name') || verifiedName || 'Doctor';

  return <section className="rtdp-profile" aria-label="Doctor account settings">
    <header className="rtdp-page-header">
      <div>
        <span className="eyebrow">DOCTOR ACCOUNT</span>
        <h1>My Profile</h1>
        <p>Manage your display information and account security.</p>
      </div>
      <span className="rtdp-status"><ShieldCheck size={15}/>{accountStatus.replaceAll('_', ' ')}</span>
    </header>

    <div className="rtdp-person">
      <span className="rtdp-person-avatar"><UserRound size={28}/></span>
      <div><strong>{shownName}</strong><small>{verifiedName ? `Verified identity: ${verifiedName}` : 'Administrator account'}</small></div>
    </div>

    <div role="tablist" aria-label="Account settings" className="rtdp-tabs">
      <button type="button" role="tab" aria-selected={tab === 'profile'} onClick={() => setTab('profile')}><UserRound size={16}/> Profile details</button>
      <button type="button" role="tab" aria-selected={tab === 'security'} onClick={() => setTab('security')}><KeyRound size={16}/> Security</button>
    </div>

    {tab === 'profile' ? <div className="rtdp-panel" role="tabpanel">
      <h2>Profile details</h2>
      <p className="rtdp-muted">Display information can be updated without changing your verified professional credentials.</p>
      {profileError && <p className="rtdp-error" role="alert">{profileError}</p>}
      {profileNotice && <p className="rtdp-success" role="status">{profileNotice}</p>}
      <form onSubmit={saveProfile} className="rtdp-fields">
        <label>Display name<input required value={displayName} maxLength={90} minLength={2} onChange={e => setDisplayName(e.target.value)} autoComplete="nickname"/></label>
        <label>Phone number<input value={phone} maxLength={25} onChange={e => setPhone(e.target.value)} type="tel" autoComplete="tel" placeholder="+254 7XX XXX XXX"/></label>
        <label>Email address<input value={user.email ?? ''} readOnly aria-readonly="true"/></label>
        <label>Account ID<input value={user.id} readOnly aria-readonly="true"/></label>
        <label>Verified professional name<input value={verifiedName || 'Not applicable'} readOnly aria-readonly="true"/></label>
        <label>Registration number<input value={registrationNumber || 'Not applicable'} readOnly aria-readonly="true"/></label>
        <label>Institution<input value={institution || 'Not provided'} readOnly aria-readonly="true"/></label>
        <div className="rtdp-form-actions"><button className="rtdp-save" disabled={saving} type="submit"><Save size={16}/>{saving ? 'Saving…' : 'Save changes'}</button></div>
      </form>
    </div> : <div className="rtdp-panel" role="tabpanel">
      <h2>Change password</h2>
      <p className="rtdp-muted">Confirm your current password before setting a new one.</p>
      {securityError && <p className="rtdp-error" role="alert">{securityError}</p>}
      {securityNotice && <p className="rtdp-success" role="status">{securityNotice}</p>}
      <form onSubmit={updatePassword} className="rtdp-fields">
        <label>Current password<input value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} type="password" autoComplete="current-password" required/></label>
        <label>New password<input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" autoComplete="new-password" minLength={12} required/></label>
        <label>Confirm new password<input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" autoComplete="new-password" minLength={12} required/></label>
        <div className="rtdp-form-actions"><button className="rtdp-save" disabled={passwordBusy} type="submit"><KeyRound size={16}/>{passwordBusy ? 'Updating…' : 'Update password'}</button></div>
      </form>
    </div>}
  </section>;
}

type AccountMenuProps = {
  name: string;
  onProfile: () => void;
  onSecurity: () => void;
  onSignOut: () => void;
};

export function DoctorAccountMenu({ name, onProfile, onSecurity, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return <div className="rtdp-account-menu" ref={ref}>
    <button type="button" ref={buttonRef} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(value => !value)} className="rtdp-account-trigger">
      <UserRound size={18}/><span>{name}</span><ChevronDown size={15}/>
    </button>
    {open && <div className="rtdp-account-dropdown" role="menu" aria-label="Doctor account">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onProfile(); }}><UserRound size={17}/> My Profile</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onSecurity(); }}><KeyRound size={17}/> Security Settings</button>
      <div className="rtdp-menu-divider"/>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={17}/> Sign Out</button>
    </div>}
  </div>;
}
