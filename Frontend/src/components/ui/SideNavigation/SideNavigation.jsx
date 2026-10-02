import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Buildings2,
  Clock,
  DocumentText,
  ElementPlus,
  Grid2,
  People,
} from "iconsax-react";
import { useAuth } from "../../../auth/AuthContext.jsx";
import { useRecentProjects } from "../../../auth/RecentProjectsContext.jsx";
import MainLogo from "../../../assets/logos/MainLogo.jsx";
import {
  createUserSideNavigationItems,
  mergeRecentProjectNavigationItems,
} from "../../../utils/sideNavigationItems.js";
import AvatarLabel from "../AvatarLabel/AvatarLabel.jsx";
import { getAvatarPresentation } from "../../../utils/avatarPresentation.js";
import Button from "../Button/Button.jsx";
import Input from "../Input/Input.jsx";
import TabItem from "../TabItem/TabItem.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
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

function SidebarRightIcon({ className }) {
  return (
    <svg
      viewBox="0 0 23 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M21.97 15V9C21.97 4 19.97 2 14.97 2H8.97C3.97 2 1.97 4 1.97 9V15C1.97 20 3.97 22 8.97 22H14.97C19.97 22 21.97 20 21.97 15Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.97 2V22"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.97021 9.44141L10.5302 12.0014L7.97021 14.5614"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashboardIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2.91667"
        y="2.91667"
        width="14.1667"
        height="14.1667"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M10 3.33301V16.6663" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.33325 9.99967H16.6666"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ProjectIcon({ className }) {
  return (
    <svg
      viewBox="0 0 23 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M6.70001 18H4.15002C2.72002 18 2 17.28 2 15.85V4.15002C2 2.72002 2.72002 2 4.15002 2H8.45001C9.88001 2 10.6 2.72002 10.6 4.15002V6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.37 8.41998V19.58C17.37 21.19 16.57 22 14.96 22H9.12C7.51 22 6.70001 21.19 6.70001 19.58V8.41998C6.70001 6.80998 7.51 6 9.12 6H14.96C16.57 6 17.37 6.80998 17.37 8.41998Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.4004 6V4.15002C13.4004 2.72002 14.1204 2 15.5504 2H19.8503C21.2803 2 22.0004 2.72002 22.0004 4.15002V15.85C22.0004 17.28 21.2803 18 19.8503 18H17.3704"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 11H14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 14H14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 22V19"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DiscoverIcon({ className }) {
  return (
    <svg
      viewBox="0 0 23 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M17.8001 2.10049L7.87009 4.59049C6.42009 4.95049 4.95009 6.42049 4.59009 7.87049L2.10009 17.8005C1.35009 20.8005 3.19009 22.6505 6.20009 21.9005L16.1301 19.4205C17.5701 19.0605 19.0501 17.5805 19.4101 16.1405L21.9001 6.20049C22.6501 3.20049 20.8001 1.35049 17.8001 2.10049Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.5C13.933 15.5 15.5 13.933 15.5 12C15.5 10.067 13.933 8.5 12 8.5C10.067 8.5 8.5 10.067 8.5 12C8.5 13.933 10.067 15.5 12 15.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon({ className }) {
  return (
    <svg
      viewBox="0 0 23 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 12.8814V11.1214C2 10.0814 2.85 9.2214 3.9 9.2214C5.71 9.2214 6.45 7.9414 5.54 6.3714C5.02 5.4714 5.33 4.3014 6.24 3.7814L7.97 2.7914C8.76 2.3214 9.78 2.6014 10.25 3.3914L10.36 3.5814C11.26 5.1514 12.74 5.1514 13.65 3.5814L13.76 3.3914C14.23 2.6014 15.25 2.3214 16.04 2.7914L17.77 3.7814C18.68 4.3014 18.99 5.4714 18.47 6.3714C17.56 7.9414 18.3 9.2214 20.11 9.2214C21.15 9.2214 22.01 10.0714 22.01 11.1214V12.8814C22.01 13.9214 21.16 14.7814 20.11 14.7814C18.3 14.7814 17.56 16.0614 18.47 17.6314C18.99 18.5414 18.68 19.7014 17.77 20.2214L16.04 21.2114C15.25 21.6814 14.23 21.4014 13.76 20.6114L13.65 20.4214C12.75 18.8514 11.27 18.8514 10.36 20.4214L10.25 20.6114C9.78 21.4014 8.76 21.6814 7.97 21.2114L6.24 20.2214C5.33 19.7014 5.02 18.5314 5.54 17.6314C6.45 16.0614 5.71 14.7814 3.9 14.7814C2.85 14.7814 2 13.9214 2 12.8814Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M9.58335 15.8333C13.0351 15.8333 15.8334 13.0351 15.8334 9.58333C15.8334 6.13155 13.0351 3.33333 9.58335 3.33333C6.13157 3.33333 3.33335 6.13155 3.33335 9.58333C3.33335 13.0351 6.13157 15.8333 9.58335 15.8333Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.6667 16.6667L15 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AddIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 4.16663V15.8333"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.16675 10H15.8334"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.41667 6.29922C7.67501 3.29922 9.21667 2.07422 12.5917 2.07422H12.7C16.425 2.07422 17.9167 3.56589 17.9167 7.29089V12.7242C17.9167 16.4492 16.425 17.9409 12.7 17.9409H12.5917C9.24167 17.9409 7.70001 16.7326 7.42501 13.7826"
        stroke="#4E4E4E"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M12.5 10H3.01666"
        stroke="#4E4E4E"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M4.87499 7.20703L2.08333 9.9987L4.87499 12.7904"
        stroke="#4E4E4E"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function getItemIcon(icon, className = "size-5 shrink-0") {
  if (icon === "dashboard") {
    return <DashboardIcon className={className} />;
  }

  if (icon === "admin-dashboard") {
    return (
      <Grid2
        className={className}
        size="20"
        color="currentColor"
        variant="Linear"
        aria-hidden="true"
      />
    );
  }

  if (icon === "requests") {
    return (
      <ElementPlus
        className={className}
        size="20"
        color="currentColor"
        variant="Linear"
        aria-hidden="true"
      />
    );
  }

  if (icon === "discover") {
    return <DiscoverIcon className={className} />;
  }

  if (icon === "settings") {
    return <SettingsIcon className={className} />;
  }

  const adminIcons = {
    users: People,
    projects: Buildings2,
    files: DocumentText,
    history: Clock,
  };
  const AdminIcon = adminIcons[icon];

  if (AdminIcon) {
    return (
      <AdminIcon
        className={className}
        size="20"
        color="currentColor"
        variant="Linear"
        aria-hidden="true"
      />
    );
  }

  return <ProjectIcon className={className} />;
}

function clearPointerFocus(event) {
  event.currentTarget.blur();
}

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
  const [internalActiveItemId, setInternalActiveItemId] =
    useState(defaultActiveItemId);
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
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
  const isActiveControlled =
    typeof activeItemId === "string" && activeItemId.length > 0;
  const isExpandedControlled = typeof expanded === "boolean";
  const resolvedActiveItemId = isActiveControlled
    ? activeItemId
    : internalActiveItemId;
  const isExpanded = isExpandedControlled ? expanded : internalExpanded;
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

  const handleItemSelect = (item) => {
    if (!isActiveControlled) {
      setInternalActiveItemId(item.id);
    }

    onItemSelect?.(item);
  };

  /**
   * Solicita alternar la expansión sin duplicar el estado proporcionado por el padre.
   * En modo no controlado actualiza el estado interno y notifica los callbacks compatibles.
   *
   * @returns {void} Actualiza o solicita la expansión de esta instancia.
   */
  const handleToggleExpanded = () => {
    const nextExpanded = !isExpanded;

    if (!isExpandedControlled) {
      setInternalExpanded(nextExpanded);
    }

    onExpandedChange?.(nextExpanded);
    onCollapseClick?.(nextExpanded);
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

          <nav
            className={clsx(
              "flex flex-col gap-[8px]",
              isExpanded ? "w-full" : "items-start",
            )}
            data-node-id={nodeIds.menu}
            aria-label="Secciones"
          >
            {visibleItems.map((item) =>
              isExpanded ? (
                <div
                  key={item.id}
                  className="flex w-full items-center"
                  style={{ minHeight: item.wrapperHeight ?? "44px" }}
                >
                  <TabItem
                    label={item.label}
                    size="M"
                    style="Brand"
                    selected={item.id === resolvedActiveItemId}
                    interactive
                    iconLeft={false}
                    iconRight={false}
                    leftIcon={getItemIcon(item.icon)}
                    rightIcon={null}
                    className="w-full justify-start"
                    aria-label={item.label}
                    onClick={() => handleItemSelect(item)}
                  />
                </div>
              ) : (
                <Tooltip
                  key={item.id}
                  asChild
                  portal
                  showTip
                  text={item.label}
                  tipPosition="Right"
                >
                  <button
                    type="button"
                    className={clsx(
                      "inline-flex h-[44px] w-[44px] items-center justify-center rounded-[var(--radius-2)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
                      item.id === resolvedActiveItemId
                        ? "bg-[var(--color-neutral-200)] text-[var(--color-text-300)]"
                        : "bg-transparent text-[var(--color-text-100)] hover:bg-[var(--color-neutral-10)] hover:text-[var(--color-text-200)]",
                    )}
                    aria-label={item.label}
                    onClick={() => handleItemSelect(item)}
                    onMouseUp={clearPointerFocus}
                    onTouchEnd={clearPointerFocus}
                  >
                    {getItemIcon(item.icon)}
                  </button>
                </Tooltip>
              ),
            )}

            {visibleItems.length === 0 && isExpanded ? (
              <p className="px-[12px] py-[8px] text-body-4 text-[var(--color-text-100)]">
                No hay coincidencias.
              </p>
            ) : null}
          </nav>
        </div>
      </div>

      <div
        data-node-id={nodeIds.footer}
        className={clsx(
          "mt-[20px] flex min-w-0 items-center",
          isExpanded ? "w-full justify-between gap-[12px]" : "self-start",
        )}
      >
        <AvatarLabel
          className="min-w-0 flex-1"
          size="M"
          label={userName}
          subtitle={userEmail}
          showLabel={isExpanded}
          showSubtitle={isExpanded}
          avatarTheme={userAvatar.theme}
          avatarContent={userAvatar.content}
          avatarInitials={userAvatar.initials}
          avatarSrc={userAvatar.src}
          avatarAlt={userName}
          avatarDecorative={false}
        />

        {isExpanded ? (
          <Button
            className="shrink-0"
            theme="Primary"
            type="Ghost"
            size="S"
            showText={false}
            showLeftIcon
            showRightIcon={false}
            iconLeft={<LogoutIcon className="size-5" />}
            tooltipPosition="Right"
            aria-label="Cerrar sesión"
            onClick={onLogoutClick}
            onMouseUp={clearPointerFocus}
            onTouchEnd={clearPointerFocus}
          />
        ) : null}
      </div>
    </aside>
  );
}

export default SideNavigation;
