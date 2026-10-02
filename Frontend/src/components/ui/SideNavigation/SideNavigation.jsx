import { useMemo, useState } from "react";
import clsx from "clsx";

import { useAuth } from "../../../auth/AuthContext.jsx";
import { useRecentProjects } from "../../../auth/RecentProjectsContext.jsx";
import MainLogo from "../../../assets/logos/MainLogo.jsx";
import {
  createUserSideNavigationItems,
  mergeRecentProjectNavigationItems,
} from "../../../utils/sideNavigationItems.js";
import { getAvatarPresentation } from "../../../utils/avatarPresentation.js";

import Button from "../Button/Button.jsx";
import Input from "../Input/Input.jsx";

import SideNavigationFooter from "./SideNavigationFooter.jsx";
import SideNavigationMenu from "./SideNavigationMenu.jsx";
import useSideNavigationState from "./hooks/useSideNavigationState.js";
import { AddIcon, SearchIcon, SidebarRightIcon } from "./SideNavigationIcons.jsx";
import {
  SIDE_NAVIGATION_DEFAULT_ITEMS,
  SIDE_NAVIGATION_DEFAULT_PROPS,
} from "./sideNavigationConfig.js";

const SIDE_NAVIGATION_NODE_IDS = {
  expanded: {
    wrapper: "2061:24560",
    header: "2056:24079",
    search: "2056:24082",
    menu: "2056:24083",
    footer: "2056:24094",
  },
  collapsed: {
    wrapper: "2061:24574",
    header: "2056:24097",
    search: "2056:24098",
    menu: "2056:24108",
    footer: "2056:23177",
  },
};

/**
 * Retira el foco residual de mouse y touch sin intervenir en la navegación de teclado.
 * Se comparte con menú y footer para conservar la misma interacción tras la extracción.
 *
 * @param {import("react").SyntheticEvent<HTMLElement>} event Interacción de puntero terminada.
 * @returns {void} Retira el foco del control de origen.
 */
function clearPointerFocus(event) {
  event.currentTarget.blur();
}

/**
 * Compone la navegación lateral a partir del usuario, sus proyectos recientes y las props públicas.
 * Conserva búsqueda y normalización local; delega selección y expansión al hook de estado.
 *
 * @param {Object} props Configuración, identidad y callbacks públicos de la navegación.
 * @returns {import("react").ReactElement} Sidebar con header, búsqueda, menú y footer.
 */
function SideNavigation({
  className,
  items,
  activeItemId = SIDE_NAVIGATION_DEFAULT_PROPS.activeItemId,
  defaultActiveItemId = SIDE_NAVIGATION_DEFAULT_PROPS.defaultActiveItemId,
  expanded,
  defaultExpanded = SIDE_NAVIGATION_DEFAULT_PROPS.defaultExpanded,
  searchPlaceholder = SIDE_NAVIGATION_DEFAULT_PROPS.searchPlaceholder,
  newOpportunityLabel = SIDE_NAVIGATION_DEFAULT_PROPS.newOpportunityLabel,
  userName = SIDE_NAVIGATION_DEFAULT_PROPS.userName,
  userEmail = SIDE_NAVIGATION_DEFAULT_PROPS.userEmail,
  userAvatarSrc = null,
  logo = null,
  onSearchChange,
  onItemSelect,
  onNewOpportunityClick,
  onLogoutClick,
  onExpandedChange,
  onCollapseClick,
  "aria-label": ariaLabel = SIDE_NAVIGATION_DEFAULT_PROPS["aria-label"],
  ...props
}) {
  const { user } = useAuth();
  const userAvatar = getAvatarPresentation({
    identity: user?.id || userEmail,
    name: userName,
    roleCode:
      typeof user?.role === "string"
        ? user.role
        : user?.role?.code || user?.roleDetails?.code,
    src: userAvatarSrc,
  });
  const { projects: recentProjects } = useRecentProjects();
  const [searchValue, setSearchValue] = useState("");
  const {
    resolvedActiveItemId,
    isExpanded,
    handleItemSelect,
    handleToggleExpanded,
  } = useSideNavigationState({
    activeItemId,
    defaultActiveItemId,
    expanded,
    defaultExpanded,
    onItemSelect,
    onExpandedChange,
    onCollapseClick,
  });
  const normalizedItems = useMemo(() => {
    const roleCode =
      typeof user?.role === "string" ? user.role : user?.role?.code;
    const baseItems =
      items === undefined
        ? createUserSideNavigationItems([], roleCode)
        : Array.isArray(items)
          ? items
          : SIDE_NAVIGATION_DEFAULT_ITEMS;

    return mergeRecentProjectNavigationItems(baseItems, recentProjects, {
      includeProjectShortcuts: roleCode !== "admin",
    });
  }, [items, recentProjects, user?.role]);
  const nodeIds = isExpanded
    ? SIDE_NAVIGATION_NODE_IDS.expanded
    : SIDE_NAVIGATION_NODE_IDS.collapsed;
  const visibleItems = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase();

    if (!normalizedQuery) {
      return normalizedItems;
    }

    return normalizedItems.filter((item) =>
      String(item.label ?? "")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [normalizedItems, searchValue]);

  const handleSearchChange = (event) => {
    setSearchValue(event.target.value);
    onSearchChange?.(event);
  };

  return (
    <aside
      className={clsx(
        "sticky top-0 flex h-screen min-h-screen self-start flex-col overflow-hidden border-r border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] transition-[width,padding] will-change-[width,padding]",
        isExpanded
          ? "w-[312px] px-[16px] pb-[16px] pt-[16px] duration-200 ease-out"
          : "w-[76px] px-[16px] py-[16px] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]",
        className,
      )}
      aria-label={ariaLabel}
      data-node-id={nodeIds.wrapper}
      {...props}
    >
      <div
        className={clsx(
          "flex min-h-0 flex-1 flex-col gap-[20px]",
          isExpanded ? "w-full" : "items-start",
        )}
      >
        <div
          className={clsx(
            "flex items-center",
            isExpanded ? "w-full justify-between gap-[12px]" : "justify-start",
          )}
          data-node-id={nodeIds.header}
        >
          {isExpanded ? (
            <div className="flex min-w-0 flex-1 items-center">
              {logo ?? <MainLogo size="32px" />}
            </div>
          ) : null}

          <Button
            theme="Primary"
            type="Outline"
            size="M"
            showText={false}
            showLeftIcon
            showRightIcon={false}
            iconLeft={<SidebarRightIcon className="size-5" />}
            className="shrink-0"
            tooltipPosition="Right"
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? "Contraer navegación lateral"
                : "Expandir navegación lateral"
            }
            onClick={handleToggleExpanded}
            onMouseUp={clearPointerFocus}
            onTouchEnd={clearPointerFocus}
          />
        </div>

        <div
          className={clsx(
            "flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
            isExpanded ? "w-full" : "items-start",
          )}
        >
          <div
            data-node-id={nodeIds.search}
            className={clsx(isExpanded && "w-full")}
          >
            {isExpanded ? (
              <Input
                type="Search bar"
                size="L"
                value={searchValue}
                onChange={handleSearchChange}
                placeholder={searchPlaceholder}
                showLabel={false}
                showHint={false}
                showLeftIcon
                showRightIcon={false}
                showLabelInfo={false}
                required={false}
                className="max-w-none w-full"
                aria-label="Buscar navegación"
              />
            ) : (
              <Button
                theme="Primary"
                type="Outline"
                size="M"
                showText={false}
                showLeftIcon
                showRightIcon={false}
                iconLeft={<SearchIcon className="size-5" />}
                tooltipPosition="Right"
                aria-label="Buscar navegación"
                onMouseUp={clearPointerFocus}
                onTouchEnd={clearPointerFocus}
              />
            )}
          </div>

          <div className={clsx(isExpanded ? "w-full" : "self-start")}>
            {isExpanded ? (
              <Button
                theme="Primary"
                type="Solid"
                size="M"
                fitContent={false}
                showLeftIcon={false}
                showRightIcon={false}
                className="w-full"
                onClick={onNewOpportunityClick}
              >
                {newOpportunityLabel}
              </Button>
            ) : (
              <Button
                theme="Primary"
                type="Solid"
                size="M"
                showText={false}
                showLeftIcon
                showRightIcon={false}
                iconLeft={<AddIcon className="size-5" />}
                tooltipPosition="Right"
                aria-label={newOpportunityLabel}
                onClick={onNewOpportunityClick}
                onMouseUp={clearPointerFocus}
                onTouchEnd={clearPointerFocus}
              />
            )}
          </div>

          <SideNavigationMenu
            items={visibleItems}
            isExpanded={isExpanded}
            activeItemId={resolvedActiveItemId}
            nodeId={nodeIds.menu}
            onItemSelect={handleItemSelect}
            onPointerFocusClear={clearPointerFocus}
          />
        </div>
      </div>

      <SideNavigationFooter
        isExpanded={isExpanded}
        nodeId={nodeIds.footer}
        userName={userName}
        userEmail={userEmail}
        userAvatar={userAvatar}
        onLogoutClick={onLogoutClick}
        onPointerFocusClear={clearPointerFocus}
      />
    </aside>
  );
}

export default SideNavigation;
