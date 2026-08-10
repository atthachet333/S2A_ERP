import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PasswordRoute, CompanyRoute } from '@/auth/RouteGuards';
import AppLayout from '@/components/layout/AppLayout';
import HomePage from '@/pages/HomePage';
const LoginPage = lazy(() => import('@/pages/LoginPage'));
import ChangePasswordPage from '@/pages/ChangePasswordPage';
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
import ProfilePage from '@/pages/ProfilePage';
import UsersPage, { UnauthorizedPage } from '@/pages/UsersPage';
import ActivityPage from '@/pages/ActivityPage';
import ModuleScaffold from '@/components/ModuleScaffold';
import NotFoundPage from '@/pages/NotFoundPage';
import ItemsPage from '@/pages/catalog/ItemsPage';
import ItemFormPage from '@/pages/catalog/ItemFormPage';
import CatalogMastersPage from '@/pages/catalog/CatalogMastersPage';
import FoodCostingPage from '@/pages/catalog/FoodCostingPage';
import MenuPage from '@/pages/catalog/MenuPage';
const RecipeBuilderPage = lazy(() => import('@/pages/catalog/RecipeBuilderPage'));
import IngredientsPage from '@/pages/catalog/IngredientsPage';
import PackagingPage from '@/pages/catalog/PackagingPage';
import IngredientFormPage from '@/pages/catalog/IngredientFormPage';
import PackagingFormPage from '@/pages/catalog/PackagingFormPage';
import CatalogWarehousePage from '@/pages/catalog/CatalogWarehousePage';
import SalesInsightPage from '@/pages/catalog/SalesInsightPage';
import CostingWorkspacePage from '@/pages/catalog/CostingWorkspacePage';
import PricingWorkspacePage from '@/pages/catalog/PricingWorkspacePage';
const SelectCompanyPage = lazy(() => import('@/pages/SelectCompanyPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/PasswordRecoveryPages').then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/PasswordRecoveryPages').then((module) => ({ default: module.ResetPasswordPage })));
const RegisterPage = lazy(() => import('@/pages/RegisterPage'));
import RoleDashboardPage from '@/pages/RoleDashboardPage';
import OrdersPage, { CustomersPage } from '@/pages/OrdersPage';
import { ReceivingPage, StockIssuePage } from '@/pages/OperationsPages';
import CompanySettingsPage from '@/pages/CompanySettingsPage';

/** เมนูที่ยังไม่มีระบบจริง — เปิด Placeholder page ที่ออกแบบไว้ */
const PLACEHOLDER_PATHS = [
  '/production', '/inventory', '/transfers', '/stock-count',
  '/reports',
];

export default function App() {
  return (
    <Suspense fallback={<div className="route-loading" role="status">กำลังเปิดหน้า…</div>}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<PasswordRoute />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/select-company" element={<SelectCompanyPage />} />
        <Route element={<CompanyRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/admin" element={<RoleDashboardPage />} />
          <Route path="/management" element={<RoleDashboardPage />} />
          <Route path="/operations" element={<RoleDashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/new" element={<OrdersPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/receiving" element={<ReceivingPage />} />
          <Route path="/receiving/new" element={<ReceivingPage />} />
          <Route path="/receiving/:id" element={<ReceivingPage />} />
          <Route path="/stock-issues" element={<StockIssuePage />} />
          <Route path="/stock-issues/new" element={<StockIssuePage />} />
          <Route path="/stock-issues/:id" element={<StockIssuePage />} />
          <Route path="/settings" element={<CompanySettingsPage />} />
          <Route path="/settings/company" element={<CompanySettingsPage />} />
          <Route path="/chef" element={<RoleDashboardPage />} />
          <Route path="/costing-dashboard" element={<RoleDashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/account/change-password" element={<ChangePasswordPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          {/* วัตถุดิบ (PART D1 — แยกจากบรรจุภัณฑ์ชัดเจน) */}
          <Route path="/ingredients" element={<IngredientsPage />} />
          <Route path="/ingredients/new" element={<IngredientFormPage />} />
          <Route path="/ingredients/:id" element={<IngredientFormPage />} />
          {/* บรรจุภัณฑ์ */}
          <Route path="/packaging" element={<PackagingPage />} />
          <Route path="/packaging/new" element={<PackagingFormPage />} />
          <Route path="/packaging/:id" element={<PackagingFormPage />} />
          {/* คลังข้อมูล + สรุปการขาย */}
          <Route path="/catalog" element={<CatalogWarehousePage />} />
          <Route path="/sales" element={<SalesInsightPage />} />
          {/* backward-compat — ทะเบียนรวมเดิม */}
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/items/new" element={<ItemFormPage />} />
          <Route path="/items/:id" element={<ItemFormPage />} />
          <Route path="/units" element={<CatalogMastersPage section="units" />} />
          <Route path="/categories" element={<CatalogMastersPage section="categories" />} />
          <Route path="/menus" element={<FoodCostingPage section="menus" />} />
          <Route path="/menus/new" element={<MenuPage mode="form" />} />
          <Route path="/menus/:id" element={<MenuPage mode="detail" />} />
          <Route path="/menus/:id/edit" element={<MenuPage mode="form" />} />
          <Route path="/recipes" element={<FoodCostingPage section="recipes" />} />
          <Route path="/recipes/new" element={<RecipeBuilderPage />} />
          <Route path="/recipes/:id" element={<RecipeBuilderPage />} />
          <Route path="/menus/:menuId/recipes/new" element={<RecipeBuilderPage />} />
          <Route path="/costing" element={<CostingWorkspacePage />} />
          <Route path="/pricing" element={<PricingWorkspacePage />} />
          {PLACEHOLDER_PATHS.map((path) => (
            <Route key={path} path={path} element={<ModuleScaffold />} />
          ))}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
        </Route>
        </Route>
      </Route>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes></Suspense>
  );
}
