"use client";

import { forwardRef } from "react";
import { BaseButton, SignInWithIdentityProviderProps } from "./base-button";

export const SignInWithGeneric = forwardRef<HTMLButtonElement, SignInWithIdentityProviderProps>(
  function SignInWithGeneric(props, ref) {
    const { children, name = "", ...restProps } = props;
    return (
      <BaseButton {...restProps} ref={ref}>
        {children ? children : <span>{name}</span>}
      </BaseButton>
    );
  },
);
