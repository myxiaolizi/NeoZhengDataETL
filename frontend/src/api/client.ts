/** 统一 API 客户端：封装 fetch、鉴权、错误处理、类型推断 */
import { message } from 'antd';

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  message?: string;
  code?: string;
  [key: string]: any;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(msg: string, status: number, code?: string) {
    super(msg);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const BASE = '/api';

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: any;
  silent?: boolean;
  raw?: boolean;
}

async function request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, silent, raw, ...rest } = opts;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((rest.headers as Record<string, string>) || {}),
  };

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (body instanceof FormData) {
      payload = body;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...rest,
      headers,
      body: payload,
      credentials: 'same-origin',
    });
  } catch (e: any) {
    const msg = '网络请求失败，请检查网络连接';
    if (!silent) message.error(msg);
    throw new ApiError(msg, 0, 'NETWORK_ERROR');
  }

  if (res.status === 401) {
    onUnauthorized?.();
    const msg = '登录已失效，请重新登录';
    if (!silent) message.warning(msg);
    throw new ApiError(msg, 401, 'UNAUTHORIZED');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      const msg = `请求失败（HTTP ${res.status}）`;
      if (!silent) message.error(msg);
      throw new ApiError(msg, res.status);
    }
    return (await res.text()) as unknown as T;
  }

  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('响应解析失败', res.status, 'PARSE_ERROR');
  }

  if (raw) return json as unknown as T;

  if (!res.ok || json.ok === false) {
    const msg = json.message || `请求失败（HTTP ${res.status}）`;
    if (!silent) message.error(msg);
    throw new ApiError(msg, res.status, json.code);
  }

  return (json.data !== undefined ? json.data : json) as T;
}

export const api = {
  get: <T = any>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T = any>(path: string, body?: any, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'POST', body }),
  put: <T = any>(path: string, body?: any, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T = any>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'DELETE' }),
  patch: <T = any>(path: string, body?: any, opts?: RequestOptions) => request<T>(path, { ...opts, method: 'PATCH', body }),
  raw: request,
};

/** 构造查询串，自动跳过空值 */
export function qs(params: Record<string, any>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? '?' + s : '';
}

export default api;
