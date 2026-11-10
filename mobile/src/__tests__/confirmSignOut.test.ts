import { Alert, Platform } from 'react-native';
import { confirmSignOut } from '@/lib/confirmSignOut';

describe('confirmSignOut', () => {
  const originalPlatform = Platform.OS;
  const originalConfirm = globalThis.confirm;

  afterEach(() => {
    Platform.OS = originalPlatform;
    globalThis.confirm = originalConfirm;
    jest.restoreAllMocks();
  });

  it('confirms and signs out on web', () => {
    Platform.OS = 'web';
    globalThis.confirm = jest.fn(() => true);
    const logout = jest.fn();

    confirmSignOut(logout);

    expect(globalThis.confirm).toHaveBeenCalledWith('Sign out?');
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('does not sign out when the web confirmation is cancelled', () => {
    Platform.OS = 'web';
    globalThis.confirm = jest.fn(() => false);
    const logout = jest.fn();

    confirmSignOut(logout);

    expect(logout).not.toHaveBeenCalled();
  });

  it('keeps the native confirmation dialog', () => {
    Platform.OS = 'android';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const logout = jest.fn();

    confirmSignOut(logout);

    expect(alert).toHaveBeenCalledWith('Sign out?', undefined, expect.any(Array));
    const buttons = alert.mock.calls[0]?.[2];
    buttons?.[1]?.onPress?.();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
