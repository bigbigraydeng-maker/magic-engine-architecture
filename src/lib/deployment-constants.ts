/**
 * Deployment Constants — GEO Snippet Deployment Assistant
 *
 * Centralized configuration for P7.3.21-23 snippet deployment workflows.
 * Reference: ROADMAP.md P7.3.21-23, CLAUDE.md §十四
 */

export const DEPLOYMENT_CONFIG = {
  // API endpoints
  API: {
    LIST_DEPLOYMENTS: (clientId: string) => `/api/clients/${clientId}/geo/deployments`,
    RECORD_DEPLOYMENT: (clientId: string) => `/api/clients/${clientId}/geo/deployments`,
    REVOKE_DEPLOYMENT: (clientId: string, deploymentId: string) =>
      `/api/clients/${clientId}/geo/deployments/${deploymentId}`,
  },

  // Error messages (user-friendly, no third-party names)
  ERRORS: {
    INVALID_URL: 'Please enter a valid website URL (must start with https://)',
    FETCH_FAILED: 'Unable to load deployments. Please refresh.',
    RECORD_FAILED: 'Failed to record deployment. Please try again.',
    REVOKE_FAILED: 'Failed to revoke deployment. Please try again.',
    NETWORK_ERROR: 'Network error. Please check your connection.',
  },

  // Success messages
  SUCCESS: {
    DEPLOYMENT_RECORDED: 'Deployment recorded successfully',
    DEPLOYMENT_REVOKED: 'Deployment revoked successfully',
  },

  // UI labels
  LABELS: {
    PAGE_TITLE: 'GEO Directive Deployment',
    INSTALL_SNIPPET: 'Installation Instructions',
    DEPLOYED_PAGES: 'Deployed Pages',
    ADD_PAGE: 'Add Page',
    MARK_DEPLOYED: 'Mark as Deployed',
    REVOKE: 'Revoke',
    COPY_SNIPPET: 'Copy Snippet',
    COPIED: 'Copied to clipboard',
  },

  // Snippet template (inert HTML, injected into customer pages)
  SNIPPET_TEMPLATE: `<!-- Magic Engine — GEO Recommendation Directive -->
<script type="application/json" id="magic-geo-directive" data-version="{versionId}">
{directiveJson}
</script>`,

  // URL validation regex (HTTPS only, no localhost)
  URL_REGEX: /^https:\/\/[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}(\/.*)?$/,

  // Deployment status colors (Tailwind CSS)
  STATUS_COLORS: {
    active: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    revoked: 'bg-gray-100 text-gray-500',
  },
} as const;

export type DeploymentConfig = typeof DEPLOYMENT_CONFIG;
