import { useEffect } from 'react';
import type { ShopUi } from '../shared/variants';
import { usePath } from './router';
import { useShop } from './state';
import { V1App } from './v1';
import { V2App } from './v2';

export function App({ ui }: { ui: ShopUi }) {
  const path = usePath();
  const { setNotice } = useShop();

  useEffect(() => {
    setNotice('');
    window.scrollTo(0, 0);
  }, [path, setNotice]);

  return ui === 'v1' ? <V1App path={path} /> : <V2App path={path} />;
}
