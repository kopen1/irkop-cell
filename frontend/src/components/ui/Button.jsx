export function Button({
  variant = 'primary',
  size,
  block = false,
  loading = false,
  type = 'button',
  className = '',
  children,
  disabled,
  ...rest
}) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner spinner-sm" aria-hidden="true" />}
      {children}
    </button>
  );
}