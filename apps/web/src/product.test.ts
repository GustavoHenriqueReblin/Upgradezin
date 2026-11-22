import { describe, expect, it } from 'vitest';
import { productPath } from '@upgradezin/shared';
import { productKeyFromUrl } from './product.ts';

describe('endereço da página do produto', () => {
  it('lê a chave codificada (ida e volta com productPath); outros endereços e código quebrado, nada', () => {
    expect(productKeyFromUrl(productPath('ssd:SDSSDA3N2T00G26'))).toBe('ssd:SDSSDA3N2T00G26');
    expect(productKeyFromUrl('/produto/id%3A42/')).toBe('id:42');
    expect(productKeyFromUrl('/produto/')).toBeNull();
    expect(productKeyFromUrl('/produto/a/b')).toBeNull();
    expect(productKeyFromUrl('/admin')).toBeNull();
    expect(productKeyFromUrl('/produto/%E0%A4%A')).toBeNull();
  });
});
