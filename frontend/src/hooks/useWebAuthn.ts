import { useState } from 'react';
import client from '@/api/client';
import { toast } from 'sonner';

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function credentialToJSON(cred: any) {
  return {
    id: cred.id,
    rawId: arrayBufferToBase64Url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: arrayBufferToBase64Url(cred.response.clientDataJSON),
      attestationObject: cred.response.attestationObject
        ? arrayBufferToBase64Url(cred.response.attestationObject)
        : undefined,
      authenticatorData: cred.response.authenticatorData
        ? arrayBufferToBase64Url(cred.response.authenticatorData)
        : undefined,
      signature: cred.response.signature
        ? arrayBufferToBase64Url(cred.response.signature)
        : undefined,
      userHandle: cred.response.userHandle
        ? arrayBufferToBase64Url(cred.response.userHandle)
        : undefined,
      transports: cred.response.getTransports?.() || [],
    },
  };
}

export function useWebAuthn() {
  const [webauthnLoading, setWebauthnLoading] = useState(false);

  const register = async (): Promise<boolean> => {
    setWebauthnLoading(true);
    try {
      const { data: optionsRes } = await client.get('/webauthn/register/options');
      if (optionsRes.status !== 'success') { toast.error('Failed to get registration options'); return false; }
      const opts = optionsRes.data;

      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: base64UrlToArrayBuffer(opts.challenge),
        rp: opts.rp,
        user: {
          id: base64UrlToArrayBuffer(opts.user.id),
          name: opts.user.name,
          displayName: opts.user.displayName,
        },
        pubKeyCredParams: opts.pubKeyCredParams,
        authenticatorSelection: opts.authenticatorSelection,
        timeout: opts.timeout,
      };

      const cred = await navigator.credentials.create({ publicKey }) as any;
      if (!cred) { toast.error('Biometric registration cancelled'); return false; }

      await client.post('/webauthn/register/verify', { credential: credentialToJSON(cred) });
      toast.success('Biometric registered successfully!');
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Biometric registration failed');
      return false;
    } finally {
      setWebauthnLoading(false);
    }
  };

  const authenticate = async (email: string): Promise<{ accessToken?: string; role?: string } | null> => {
    setWebauthnLoading(true);
    try {
      const { data: optionsRes } = await client.get('/webauthn/auth/options', { params: { email } });
      if (optionsRes.status !== 'success') { toast.error('Biometric not set up for this account'); return null; }
      const opts = optionsRes.data;

      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: base64UrlToArrayBuffer(opts.challenge),
        allowCredentials: opts.allowCredentials?.map((c: any) => ({
          type: c.type,
          id: base64UrlToArrayBuffer(c.id),
          transports: c.transports,
        })),
        userVerification: opts.userVerification,
        timeout: opts.timeout,
      };

      const assertion = await navigator.credentials.get({ publicKey }) as any;
      if (!assertion) { toast.error('Biometric authentication cancelled'); return null; }

      const { data: verifyRes } = await client.post('/webauthn/auth/verify', {
        email,
        credential: credentialToJSON(assertion),
      });

      if (verifyRes.status === 'success') {
        toast.success('Biometric login successful!');
        return { accessToken: verifyRes.accessToken, role: verifyRes.role };
      }
      return null;
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Biometric authentication failed');
      return null;
    } finally {
      setWebauthnLoading(false);
    }
  };

  return { register, authenticate, webauthnLoading };
}
