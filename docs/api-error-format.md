# ElderFlow API – Standard Error Response Format

All ElderFlow API endpoints return JSON.  
When an error occurs (4xx or 5xx), the response body uses a **standard error shape**.

---

## 1. Base Error Shape

```json
{
  "error": "Human readable error message",
  "code": "OPTIONAL_ERROR_CODE",
  "details": "OPTIONAL_EXTRA_DETAILS"
}
