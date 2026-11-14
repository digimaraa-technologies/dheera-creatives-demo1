import { ArrowRight, Package, Scissors } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { catalogApi } from '../api/catalog';
import { EmptyState } from '../components/EmptyState';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';
import type { CatalogQuery } from '../types';

const BASE_QUERY: CatalogQuery = {
  page: 1,
  pageSize: 1,
  search: '',
  category: '',
  isActive: '',
  sortBy: 'displayOrder',
  sortDir: 'asc',
};

interface Stats {
  products: number;
  activeProducts: number;
  services: number;
  activeServices: number;
}

export function DashboardPage() {
  const { admin } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(() => setReload((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setStats(null);
    setError(null);

    Promise.all([
      catalogApi.list('products', BASE_QUERY),
      catalogApi.list('products', { ...BASE_QUERY, isActive: 'true' }),
      catalogApi.list('services', BASE_QUERY),
      catalogApi.list('services', { ...BASE_QUERY, isActive: 'true' }),
    ])
      .then(([products, activeProducts, services, activeServices]) => {
        if (!active) return;
        setStats({
          products: products.total,
          activeProducts: activeProducts.total,
          services: services.total,
          activeServices: activeServices.total,
        });
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load dashboard.');
      });

    return () => {
      active = false;
    };
  }, [reload]);

  return (
    <div className="stack">
      <section className="page-intro">
        <h2>Welcome back, {admin?.username ?? 'Admin'}.</h2>
        <p>Everything here reads from and writes to the live catalogue APIs.</p>
      </section>

      {error && (
        <div className="error-state">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!error && !stats && <LoadingSpinner />}

      {stats && (
        <section className="stat-grid" aria-label="Catalogue statistics">
          <StatCard
            label="Products"
            value={stats.products}
            detail={`${stats.activeProducts} active`}
            icon={Package}
            to="/products"
          />
          <StatCard
            label="Services"
            value={stats.services}
            detail={`${stats.activeServices} active`}
            icon={Scissors}
            to="/services"
          />
        </section>
      )}

      <section className="quick-grid">
        <Link to="/products" className="quick-card">
          <span className="quick-icon">
            <Package size={20} />
          </span>
          <div>
            <strong>Manage products</strong>
            <span>Add, edit, hide or remove product entries.</span>
          </div>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <Link to="/services" className="quick-card">
          <span className="quick-icon">
            <Scissors size={20} />
          </span>
          <div>
            <strong>Manage services</strong>
            <span>Keep the services catalogue current.</span>
          </div>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>

      {stats && stats.products + stats.services === 0 && (
        <EmptyState
          title="The catalogue is empty"
          description="Add your first product or service to start filling the public site."
          action={
            <Link to="/products/new" className="btn btn-primary">
              Add a product
            </Link>
          }
        />
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  detail: string;
  icon: typeof Package;
  to: string;
}

function StatCard({ label, value, detail, icon: Icon, to }: StatCardProps) {
  return (
    <Link to={to} className="stat-card">
      <span className="stat-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">{detail}</span>
    </Link>
  );
}
