export function LoadingSpinner({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <div className={fullPage ? 'spinner-wrap spinner-full' : 'spinner-wrap'}>
      <span className="spinner" role="status" aria-label="Loading" />
    </div>
  );
}
