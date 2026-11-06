import { SiteHeader } from './SiteHeader.jsx';
import { Brand } from './Brand.jsx';

export function PlatformLayout({ children, className = '' }) {
  return (
    <div className={`platform-shell ${className}`}>
      <div className="platform-content">
        <SiteHeader />
        {children}
        <footer className="platform-footer">
          <Brand className="footer-brand" />
          <span>Think. Trace. Transform.</span>
        </footer>
      </div>
    </div>
  );
}
