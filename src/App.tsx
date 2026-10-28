import { Home } from './pages/Home';
import { Spike } from './pages/Spike';

export function App() {
  // Two pages don't warrant a router.
  return location.pathname.replace(/\/$/, '') === '/spike' ? <Spike /> : <Home />;
}
