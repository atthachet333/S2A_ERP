import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PasswordRoute } from '@/auth/RouteGuards';
import AppLayout from '@/components/layout/AppLayout';
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
import ChangePasswordPage from '@/pages/ChangePasswordPage';
import DashboardPage from '@/pages/DashboardPage';
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
import RecipeBuilderPage from '@/pages/catalog/RecipeBuilderPage';
import IngredientsPage from '@/pages/catalog/IngredientsPage';
import PackagingPage from '@/pages/catalog/PackagingPage';
import IngredientFormPage from '@/pages/catalog/IngredientFormPage';
import PackagingFormPage from '@/pages/catalog/PackagingFormPage';
import CatalogWarehousePage from '@/pages/catalog/CatalogWarehousePage';
import SalesInsightPage from '@/pages/catalog/SalesInsightPage';
import CostingWorkspacePage from '@/pages/catalog/CostingWorkspacePage';
import PricingWorkspacePage from '@/pages/catalog/PricingWorkspacePage';

/** เมนูที่ยังไม่มีระบบจริง — เปิด Placeholder page ที่ออกแบบไว้ */
const PLACEHOLDER_PATHS = [
  '/receiving', '/production', '/inventory', '/transfers', '/stock-count',
  '/reports', '/settings',
];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<PasswordRoute />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
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
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
