#!/usr/bin/env ruby
# Cross-check the publication boundary and its executable verification gates.
require 'json'
require 'open3'
require 'yaml'

root = File.expand_path('../..', __dir__)
workflow = YAML.load_file(File.join(root, '.github/workflows/login-image.yml'))
jobs = workflow.fetch('jobs')
api = JSON.parse(File.read(File.join(root, 'apps/api/project.json'))).fetch('targets')

def check(condition, message)
  abort "FAIL: #{message}" unless condition
end

def commands(job)
  job.fetch('steps').map { |step| step['run'] }.compact.join("\n")
end

verification = %w[release-script image issuer-image]
publisher = jobs.fetch('promote')
check(publisher.fetch('needs').sort == verification.sort, 'publisher must depend on every verification job')
check(publisher.fetch('if') == "github.event_name == 'push'", 'pull requests must never publish')
verification.each do |name|
  job = jobs.fetch(name)
  check(!commands(job).match?(/push-verified|release\.sh promote|docker push/), "#{name} publishes before the shared gate")
  job.fetch('steps').each do |step|
    check(!step.fetch('uses', '').match?(/google-github-actions\/auth|docker\/login-action/), "#{name} obtains publishing credentials")
    check(!step['continue-on-error'], "#{name} ignores a failed check")
  end
end

issuer = jobs.fetch('issuer-image')
issuer_commands = commands(issuer)
%w[build lint test-unit test-integration pack-platform].each do |target|
  check(api.key?(target), "API target #{target} does not exist")
  check(issuer_commands.include?("pnpm nx run @zitadel/api:#{target}"), "issuer omits #{target}")
end
check(issuer_commands.include?('go build ./... && go vet ./...'), 'issuer omits compiler/vet gate')
check(api.fetch('lint-install').fetch('command').end_with?(' v2.9.0'), 'API linter must support Go 1.26')
check(issuer_commands.include?('@zitadel/api:test-integration --skip-nx-cache'), 'integration tests must execute, not restore cache')
check(api.fetch('test-integration').fetch('dependsOn').sort == %w[test-integration-run-api test-integration-run-db], 'integration test services changed')
check(issuer_commands.index('@zitadel/api:test-integration') < issuer_commands.index('smoke_issuer_image.sh'), 'packaged smoke must follow integration tests')
check(issuer_commands.index('smoke_issuer_image.sh') < issuer_commands.index('docker save'), 'only smoked bytes may be uploaded')
check(issuer.fetch('env').values_at('GOOS', 'GOARCH') == %w[linux amd64], 'issuer must target Linux amd64')
check(issuer.fetch('steps').any? { |step| step.fetch('uses', '').start_with?('actions/setup-go@') && step.fetch('with', {})['go-version-file'] == 'go.mod' }, 'Go must use the repository toolchain')

%w[image issuer-image].each do |name|
  job = jobs.fetch(name)
  check(commands(job).include?('pnpm install --frozen-lockfile'), "#{name} omits the frozen workspace install")
  check(!commands(job).match?(/pnpm install[^\n]*--filter/), "#{name} excludes Nx project dependencies")
  check(job.fetch('steps').any? { |step| step.fetch('uses', '').start_with?('actions/upload-artifact@') }, "#{name} does not preserve its verified image")
end

login = jobs.fetch('image')
login_commands = commands(login)
%w[TURNSTILE_SECRET_KEY ZITADEL_SERVICE_USER_TOKEN ZITADEL_SESSION_COOKIE_SECRET].each do |name|
  check(login.fetch('env').fetch(name).start_with?('ci-build-'), "#{name} needs a synthetic build sentinel")
end
check(login_commands.include?('@zitadel/login:build --skip-nx-cache'), 'sentinel build must execute')
check(login.fetch('steps').any? { |step| step.fetch('run', '') == 'pnpm nx run @zitadel/login:build --skip-nx-cache' && step.fetch('env', {})['TURNSTILE_ENABLED'] == 'true' }, 'sentinel build must enable Turnstile')
check(login_commands.include?('check_login_client_secrets.py apps/login/.next'), 'client artifact scan missing')
check(login_commands.index('check_login_client_secrets.py') < login_commands.index('docker build'), 'scan must precede packaging')
check(login_commands.include?('-e TURNSTILE_ENABLED=false'), 'general smoke must explicitly disable Turnstile')
check(login_commands.include?('smoke_login_turnstile.sh'), 'enabled packaged runtime check missing')

publish_commands = commands(publisher)
check(publish_commands.include?('push-verified zitadel-login:ci "${IMAGE_BASE%/}/zitadel-login"'), 'Login image publication missing')
check(publish_commands.include?('push-verified zitadel:ci "${IMAGE_BASE%/}/zitadel"'), 'issuer image publication missing')
check(publish_commands.include?('"${IMAGE_BASE%/}/zitadel=apps/api/VERSION"'), 'issuer version promotion missing')
check(publish_commands.include?('"${IMAGE_BASE%/}/zitadel-login=apps/login/VERSION"'), 'Login version promotion missing')
check(publish_commands.index('docker load') < publish_commands.index('push-verified'), 'publisher must load the verified artifacts')

jobs.each do |name, job|
  job.fetch('steps').each do |step|
    next unless step['run']
    shell = step.fetch('run').gsub(/\$\{\{.*?\}\}/m, 'CI_VALUE')
    _, stderr, result = Open3.capture3('bash', '-n', stdin_data: shell)
    check(result.success?, "#{name} contains invalid shell: #{stderr}")
  end
end
smoke = File.read(File.join(root, '.github/scripts/smoke_issuer_image.sh'))
%w[/ui/login/register /ui/login/password /ui/login/device /debug/ready].each do |path|
  check(smoke.include?(path), "packaged smoke omits #{path}")
end
check(File.read(File.join(root, 'apps/api/VERSION')).strip.match?(/\A\d+\.\d+\.\d+\z/), 'issuer version must be semver')
check(File.read(File.join(root, 'apps/api/Dockerfile')).include?('org.opencontainers.image.revision="${SERVICE_REVISION}"'), 'issuer image lacks its commit label')
puts 'Image workflow publication boundary and shell checks passed'
