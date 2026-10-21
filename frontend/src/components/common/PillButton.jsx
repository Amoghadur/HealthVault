export default function PillButton({
  children,
  variant = 'outline', // 'solid', 'primary', 'outline', 'ghost'
  size = 'md', // 'sm', 'md', 'lg'
  icon = null,
  iconPosition = 'left',
  onClick,
  disabled = false,
  className = '',
  type = 'button',
  ...props
}) {
  const sizeStyles = {
    sm: { padding: '7px 16px', fontSize: '11px', gap: '6px' },
    md: { padding: '10px 22px', fontSize: '12px', gap: '8px' },
    lg: { padding: '14px 28px', fontSize: '13px', gap: '10px' },
  }[size] || { padding: '10px 22px', fontSize: '12px', gap: '8px' };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`pill-button pill-button-${variant} ${className}`}
      style={{
        ...sizeStyles,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      {...props}
    >
      {icon && iconPosition === 'left' && <span className="button-icon">{icon}</span>}
      <span>{children}</span>
      {icon && iconPosition === 'right' && <span className="button-icon">{icon}</span>}
    </button>
  );
}
