/* Mantiene y reutiliza los proyectos recientes del usuario para la navegación. */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../api/http.js";
import {
  RECENT_PROJECTS_FETCH_LIMIT,
  getRecentProjectsScope,
  toRecentProjectCacheEntries,
} from "../utils/recentProjects.js";
import { useAuth } from "./AuthContext.jsx";

const RECENT_PROJECTS_CACHE_PREFIX = "arca_recent_projects_v3";
const LEGACY_RECENT_PROJECTS_CACHE_PREFIXES = [
  "arca_recent_projects_v1",
  "arca_recent_projects_v2",
];
const pendingRequests = new Map();
const RecentProjectsContext = createContext({
  loading: false,
  projects: [],
});

// Genera una clave de caché aislada por usuario.
function getUserCacheKey(user) {
  const userId = user?.id;

  return userId === undefined || userId === null
    ? null
    : `${RECENT_PROJECTS_CACHE_PREFIX}:${userId}`;
}

// Recupera proyectos recientes válidos desde sessionStorage.
function readCachedProjects(cacheKey) {
  if (!cacheKey || typeof window === "undefined") {
    return null;
  }

  try {
    const cachedValue = JSON.parse(window.sessionStorage.getItem(cacheKey));

    if (!Array.isArray(cachedValue?.projects)) {
      return null;
    }

    return {
      projects: toRecentProjectCacheEntries(cachedValue.projects),
    };
  } catch {
    return null;
  }
}

// Guarda una versión segura de los proyectos recientes en sessionStorage.
function writeCachedProjects(cacheKey, projects) {
  if (!cacheKey || typeof window === "undefined") {
    return;
  }

  try {
    const safeProjects = toRecentProjectCacheEntries(projects);

    window.sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ projects: safeProjects, savedAt: Date.now() }),
    );
  } catch {
    // The in-memory provider remains available in restricted browsers.
  }
}

// Deduplica solicitudes concurrentes de proyectos recientes para el mismo usuario y alcance.
function requestRecentProjects(cacheKey, scope) {
  const requestKey = `${cacheKey}:${scope}`;

  if (!pendingRequests.has(requestKey)) {
    const request = api.projects
      .list({ limit: RECENT_PROJECTS_FETCH_LIMIT, scope })
      .then((data) => toRecentProjectCacheEntries(data.projects))
      .finally(() => pendingRequests.delete(requestKey));

    pendingRequests.set(requestKey, request);
  }

  return pendingRequests.get(requestKey);
}

// Mantiene la sesión de caché, revalida datos y expone el estado al contexto.
function RecentProjectsSession({ cacheKey, children, scope }) {
  const [cachedValue] = useState(() => readCachedProjects(cacheKey));
  const [projects, setProjects] = useState(cachedValue?.projects || []);
  const [loading, setLoading] = useState(!cachedValue);

  useEffect(() => {
    let isMounted = true;

    if (cachedValue) {
      writeCachedProjects(cacheKey, cachedValue.projects);
    }

    requestRecentProjects(cacheKey, scope)
      .then((nextProjects) => {
        if (!isMounted) {
          return;
        }

        setProjects(nextProjects);
        writeCachedProjects(cacheKey, nextProjects);
      })
      .catch(() => {
        // Keep the last valid cached navigation when revalidation fails.
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [cacheKey, cachedValue, scope]);

  const value = useMemo(
    () => ({ loading, projects }),
    [loading, projects],
  );

  return (
    <RecentProjectsContext.Provider value={value}>
      {children}
    </RecentProjectsContext.Provider>
  );
}

// Selecciona el alcance de proyectos según el usuario y limpia cachés antiguas.
export function RecentProjectsProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;
  const roleCode =
    typeof user?.role === "string" ? user.role : user?.role?.code;
  const scope = getRecentProjectsScope(roleCode);
  const userCacheKey = getUserCacheKey(user);
  const cacheKey = userCacheKey ? `${userCacheKey}:${scope}` : null;

  useEffect(() => {
    if (userId === undefined || userId === null) {
      return;
    }

    try {
      LEGACY_RECENT_PROJECTS_CACHE_PREFIXES.forEach((prefix) => {
        window.sessionStorage.removeItem(`${prefix}:${userId}`);
        window.sessionStorage.removeItem(`${prefix}:${userId}:accessible`);
        window.sessionStorage.removeItem(`${prefix}:${userId}:owned`);
      });
    } catch {
      // Ignore storage errors in restricted browsers.
    }
  }, [userId]);

  if (!cacheKey) {
    return (
      <RecentProjectsContext.Provider value={{ loading: false, projects: [] }}>
        {children}
      </RecentProjectsContext.Provider>
    );
  }

  return (
    <RecentProjectsSession key={cacheKey} cacheKey={cacheKey} scope={scope}>
      {children}
    </RecentProjectsSession>
  );
}

// Hook para consumir proyectos recientes y su estado de carga.
export function useRecentProjects() {
  return useContext(RecentProjectsContext);
}
