import { Link } from 'react-router-dom';

export function Brand({ className = '', homeLabel = 'Codexa home' }) {
  return (
    <Link className={`brand ${className}`.trim()} to="/" aria-label={homeLabel}>
      <svg className="brand-mark" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <path d="M11 12.5 20 8l9 4.5v9L20 26l-9-4.5v-9Z" />
        <path d="m11 21.5 9 4.5v7l-9-4.5v-7Zm18 0-9 4.5v7l9-4.5v-7Z" />
        <circle cx="20" cy="16.5" r="2" />
        <circle cx="14.5" cy="20" r="1.2" />
        <circle cx="25.5" cy="20" r="1.2" />
      </svg>
      <span>Codexa<span className="brand-dot">.</span></span>
    </Link>
  );
}
