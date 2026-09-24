import mainLogo from './assets/rttrack-logo.png';
import sidebarLogo from './assets/rttrack-logo-sidebar.png';
import './brand-logo.css';

type BrandLogoProps = {
  variant?: 'auth' | 'sidebar';
};

export default function BrandLogo({ variant = 'auth' }: BrandLogoProps) {
  const src = variant === 'sidebar' ? sidebarLogo : mainLogo;
  return (
    <div className={`rttrack-brand-logo-wrap rttrack-brand-logo-wrap-${variant}`}>
      <img
        className={`rttrack-brand-logo rttrack-brand-logo-${variant}`}
        src={src}
        alt="RTTRACK"
        draggable={false}
      />
    </div>
  );
}
