import { describe, expect, it } from 'vitest';
import { linkNoProvedor } from './link-provedor';

describe('linkNoProvedor', () => {
  it('Gmail: escolhe a conta por authuser e abre a mensagem pelo id', () => {
    const link = linkNoProvedor({
      provider: 'GOOGLE',
      accountEmail: 'v.sasaki79@gmail.com',
      providerId: '18f3a2b1c4d5e6f7',
    });
    expect(link?.url).toBe(
      'https://mail.google.com/mail/u/?authuser=v.sasaki79%40gmail.com#all/18f3a2b1c4d5e6f7',
    );
    expect(link?.rotulo).toBe('abrir no Gmail');
  });

  it('Outlook corporativo vai para office.com', () => {
    const link = linkNoProvedor({
      provider: 'MICROSOFT',
      accountEmail: 'vinicius.sasaki@unitedcom.com.br',
      providerId: 'AAMkAGI2=',
    });
    expect(link?.url).toBe('https://outlook.office.com/mail/deeplink/read/AAMkAGI2%3D');
  });

  it('Outlook pessoal (hotmail) vai para live.com', () => {
    const link = linkNoProvedor({
      provider: 'MICROSOFT',
      accountEmail: 'viniciussasaki@hotmail.com',
      providerId: 'AAMk-_x=',
    });
    expect(link?.url.startsWith('https://outlook.live.com/mail/0/deeplink/read/')).toBe(true);
  });

  it('IMAP e iCloud nao tem link estavel', () => {
    expect(
      linkNoProvedor({ provider: 'IMAP_CALDAV', accountEmail: 'a@b.c', providerId: '123' }),
    ).toBeUndefined();
    expect(linkNoProvedor({ provider: 'APPLE', accountEmail: 'a@icloud.com', providerId: '1' })).toBeUndefined();
  });

  it('sem providerId nao inventa link', () => {
    expect(linkNoProvedor({ provider: 'GOOGLE', accountEmail: 'a@gmail.com', providerId: '' })).toBeUndefined();
  });
});
