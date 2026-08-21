/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  metadata?: ApiMetadata;
}

/**
 * API error response
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Pagination metadata
 */
export interface ApiMetadata {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  metadata: ApiMetadata;
}

/**
 * API request with pagination
 */
export interface PaginatedRequest {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
