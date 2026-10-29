"use client";

import { AuthenticationMethodType } from "@zitadel/proto/zitadel/user/v2/user_service_pb";
import { EMAIL, SMS, TOTP, U2F } from "./auth-methods";

type Props = {
  loginName?: string;
  sessionId?: string;
  requestId?: string;
  organization?: string;
  userMethods: AuthenticationMethodType[];
};

export function ChooseSecondFactor({ loginName, sessionId, requestId, organization, userMethods }: Props) {
  const params = new URLSearchParams({});

  if (loginName) {
    params.append("loginName", loginName);
  }
  if (sessionId) {
    params.append("sessionId", sessionId);
  }
  if (requestId) {
    params.append("requestId", requestId);
  }
  if (organization) {
    params.append("organization", organization);
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {userMethods.map((method) => {
        switch (method) {
          case AuthenticationMethodType.TOTP:
            return TOTP(false, "/otp/time-based?" + params);
          case AuthenticationMethodType.U2F:
            return U2F(false, "/u2f?" + params);
          case AuthenticationMethodType.OTP_EMAIL:
            return EMAIL(false, "/otp/email?" + params);
          case AuthenticationMethodType.OTP_SMS:
            return SMS(false, "/otp/sms?" + params);
          default:
            return null;
        }
      })}
    </div>
  );
}
