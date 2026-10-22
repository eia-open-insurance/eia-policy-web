import React from 'react';

/**
 * The shell owns SPA routing. Pushing history and re-broadcasting popstate keeps
 * cross-vertical links inside the shell; a hard navigation is the last resort.
 */
export function navigateTo(path) {
  try {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch (e) {
    window.location.assign(path);
  }
}

export default function CrossLink({ href, className, title, children, ...rest }) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}
