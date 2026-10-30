"use client";

import { Logo } from "@/components/logo";
import { useResponsiveLayout } from "@/lib/theme-hooks";
import { BrandingSettings } from "@zitadel/proto/zitadel/settings/v2/branding_settings_pb";
import React, { Children, ReactNode } from "react";
import { Card } from "./card";
import { ThemeWrapper } from "./theme-wrapper";

/**
 * DynamicTheme component handles layout switching between traditional top-to-bottom
 * and modern side-by-side layouts based on NEXT_PUBLIC_THEME_LAYOUT.
 *
 * For side-by-side layout:
 * - First child: Goes to left side (title, description, etc.)
 * - Second child: Goes to right side (forms, buttons, etc.)
 * - Single child: Falls back to right side for backward compatibility
 *
 * For top-to-bottom layout:
 * - All children rendered in traditional centered layout
 */
export function DynamicTheme({
  branding,
  children,
}: {
  children: ReactNode | ((isSideBySide: boolean) => ReactNode);
  branding?: BrandingSettings;
}) {
  const { isSideBySide } = useResponsiveLayout();

  // Resolve children immediately to avoid passing functions through React
  const actualChildren: ReactNode = React.useMemo(() => {
    if (typeof children === "function") {
      return (children as (isSideBySide: boolean) => ReactNode)(isSideBySide);
    }
    return children;
  }, [children, isSideBySide]);

  return (
    <ThemeWrapper branding={branding}>
      {isSideBySide
        ? // Side-by-side layout: first child goes left, second child goes right
          (() => {
            const childArray = Children.toArray(actualChildren);
            const leftContent = childArray[0] || null;
            const rightContent = childArray[1] || null;

            // If there's only one child, it's likely the old format - keep it on the right side
            const hasLeftRightStructure = childArray.length === 2;

            return (
              <div className="relative mx-auto w-full max-w-[1100px] px-8 py-4">
                <Card>
                  <div className="flex min-h-[400px]">
                    {/* Left side: First child + branding */}
                    <div className="from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 flex w-1/2 flex-col justify-center bg-gradient-to-br p-4 lg:p-8">
                      <div className="mx-auto max-w-[440px] space-y-8">
                        {/* Logo and branding */}
                        {branding && (
                          <Logo
                            lightSrc={branding.lightTheme?.logoUrl}
                            darkSrc={branding.darkTheme?.logoUrl}
                            themeMode={branding.themeMode}
                            height={150}
                            width={150}
                          />
                        )}

                        {/* First child content (title, description) - only if we have left/right structure */}
                        {hasLeftRightStructure && (
                          <div className="flex flex-col items-start space-y-4 text-left">
                            {/* Apply larger styling to the content */}
                            <div className="space-y-6 [&_h1]:text-left [&_h1]:text-4xl [&_h1]:leading-tight [&_h1]:text-gray-900 [&_h1]:lg:text-4xl [&_h1]:dark:text-white [&_p]:text-left [&_p]:leading-relaxed [&_p]:text-gray-700 [&_p]:dark:text-gray-300">
                              {leftContent}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right side: Second child (form) or single child if old format */}
                    <div className="flex w-1/2 items-center justify-center p-4 lg:p-8">
                      <div className="w-full max-w-[440px]">
                        <div className="space-y-6">{hasLeftRightStructure ? rightContent : leftContent}</div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })()
        : // Baseproof's card (baseproof/legal-agents#120): the wordmark, then
          // the title and its line, then the form, all left-aligned. On a
          // phone there is no card: the page is the card's colour, the
          // content 16px from its edges, so a frame inside the screen costs
          // no width; the wordmark stays at the top and the block under it
          // sits in the space down to the footer, 40% of that space above it
          // and 60% below (two spacers, 2:3), so its buttons fall where a
          // thumb reaches. A page taller than the screen leaves the spacers
          // nothing.
          (() => {
            const childArray = Children.toArray(actualChildren);
            const titleContent = childArray[0] || null;
            const formContent = childArray[1] || null;
            const hasMultipleChildren = childArray.length > 1;

            return (
              <div className="relative mx-auto w-full max-w-[440px] max-sm:flex max-sm:flex-1 max-sm:flex-col sm:py-4">
                <div className="text-text-light-500 dark:text-text-dark-500 flex flex-col px-4 pt-6 pb-6 max-sm:flex-1 sm:rounded-[16px] sm:border sm:border-[var(--bp-card-border)] sm:bg-[var(--bp-card)] sm:px-10 sm:pt-10 sm:pb-9">
                  {branding && (
                    <div className="mb-5 flex sm:mb-7">
                      <Logo
                        lightSrc={branding.lightTheme?.logoUrl}
                        darkSrc={branding.darkTheme?.logoUrl}
                        themeMode={branding.themeMode}
                        height={28}
                        width={94.5}
                      />
                    </div>
                  )}

                  <div aria-hidden="true" className="max-sm:flex-[2]" />
                  {hasMultipleChildren ? (
                    <>
                      {/* the title and its line sit 4px apart on every page, whatever spacing the page gives them */}
                      <div className="flex w-full flex-col items-start gap-1 text-left [&>div]:space-y-1">
                        {titleContent}
                      </div>
                      <div className="mt-5 w-full sm:mt-7">{formContent}</div>
                    </>
                  ) : (
                    <div className="w-full">{actualChildren}</div>
                  )}
                  <div aria-hidden="true" className="max-sm:flex-[3]" />
                </div>
              </div>
            );
          })()}
    </ThemeWrapper>
  );
}
