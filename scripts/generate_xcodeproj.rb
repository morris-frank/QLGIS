#!/usr/bin/env ruby

require "fileutils"
require "xcodeproj"

ROOT = File.expand_path("..", __dir__)
PROJECT_PATH = File.join(ROOT, "QLGIS.xcodeproj")

APP_SOURCES = %w[
  ContentView.swift
  QLGISApp.swift
].freeze

APP_FILES = %w[
  Info.plist
].freeze

CORE_SOURCES = %w[
  PreviewBootstrap.swift
  PreviewDataResponseBuilder.swift
  PreviewError.swift
  PreviewFileKind.swift
].freeze

EXTENSION_SOURCES = %w[
  PreviewConfiguration.swift
  PreviewSchemeHandler.swift
  PreviewViewController.swift
].freeze

TEST_SOURCES = %w[
  PreviewBootstrapTests.swift
  PreviewDataResponseBuilderTests.swift
  PreviewFileKindTests.swift
].freeze

def add_files(group, filenames)
  filenames.map { |filename| group.new_file(filename) }
end

def configure_target(target, settings)
  target.build_configurations.each do |config|
    config.base_configuration_reference = settings[:base_config] if settings[:base_config]
    settings[:build_settings].each do |key, value|
      config.build_settings[key] = value
    end
  end
end

def add_framework(project, target, framework_name)
  file_ref = project.frameworks_group.new_file("System/Library/Frameworks/#{framework_name}")
  target.frameworks_build_phase.add_file_reference(file_ref, true)
end

FileUtils.rm_rf(PROJECT_PATH)
project = Xcodeproj::Project.new(PROJECT_PATH)

project.root_object.attributes["LastSwiftUpdateCheck"] = "1640"
project.root_object.attributes["ORGANIZATIONNAME"] = "QLGIS"

base_config = project.main_group.new_file("Config/Base.xcconfig")

app_group = project.main_group.new_group("QLGIS", "QLGIS")
core_group = project.main_group.new_group("QLGISCore", "QLGISCore")
extension_group = project.main_group.new_group("QLGISPreviewExtension", "QLGISPreviewExtension")
tests_group = project.main_group.new_group("QLGISCoreTests", "QLGISCoreTests")

app_target = project.new_target(:application, "QLGIS", :osx, "12.0")
core_target = project.new_target(:framework, "QLGISCore", :osx, "12.0")
extension_target = project.new_target(:app_extension, "QLGISPreviewExtension", :osx, "12.0")
test_target = project.new_target(:unit_test_bundle, "QLGISCoreTests", :osx, "12.0")

app_refs = add_files(app_group, APP_SOURCES)
APP_FILES.each { |filename| app_group.new_file(filename) }
core_refs = add_files(core_group, CORE_SOURCES)
extension_refs = add_files(extension_group, EXTENSION_SOURCES)
test_refs = add_files(tests_group, TEST_SOURCES)

app_refs.each { |ref| app_target.source_build_phase.add_file_reference(ref, true) }
core_refs.each { |ref| core_target.source_build_phase.add_file_reference(ref, true) }
extension_refs.each { |ref| extension_target.source_build_phase.add_file_reference(ref, true) }
test_refs.each { |ref| test_target.source_build_phase.add_file_reference(ref, true) }

add_framework(project, extension_target, "QuickLookUI.framework")
add_framework(project, extension_target, "WebKit.framework")

extension_target.frameworks_build_phase.add_file_reference(core_target.product_reference, true)
test_target.frameworks_build_phase.add_file_reference(core_target.product_reference, true)

extension_target.add_dependency(core_target)
test_target.add_dependency(core_target)
app_target.add_dependency(extension_target)

embed_extensions_phase = app_target.new_copy_files_build_phase("Embed App Extensions")
embed_extensions_phase.dst_subfolder_spec = "13"
embed_extensions_phase.add_file_reference(extension_target.product_reference, true)

embed_frameworks_phase = extension_target.new_copy_files_build_phase("Embed Frameworks")
embed_frameworks_phase.dst_subfolder_spec = "10"
embed_frameworks_phase.add_file_reference(core_target.product_reference, true)

build_web_phase = extension_target.new_shell_script_build_phase("Build Web Preview")
build_web_phase.always_out_of_date = "1"
build_web_phase.output_paths = ["$(DERIVED_FILE_DIR)/web-preview-build.stamp"]
build_web_phase.shell_script = <<~SCRIPT
  set -euo pipefail

  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
  WEB_ROOT="${SRCROOT}/web"
  NODE_BIN="$(command -v node || true)"

  if [ ! -d "${WEB_ROOT}/node_modules" ]; then
    echo "error: Missing web/node_modules. Run 'npm install' in ${WEB_ROOT} first."
    exit 1
  fi

  if [ -z "${NODE_BIN}" ]; then
    echo "error: Node.js is required to build the web preview bundle."
    exit 1
  fi

  "${NODE_BIN}" "${WEB_ROOT}/scripts/build.mjs"

  DESTINATION="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Web"
  mkdir -p "${DESTINATION}"
  rsync -a --delete "${WEB_ROOT}/dist/" "${DESTINATION}/"

  touch "${DERIVED_FILE_DIR}/web-preview-build.stamp"
SCRIPT

common_settings = {
  "CC" => "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang",
  "CLANG_ENABLE_MODULES" => "YES",
  "CLANG_ENABLE_EXPLICIT_MODULES" => "NO",
  "CODE_SIGN_STYLE" => "Automatic",
  "CURRENT_PROJECT_VERSION" => "1",
  "DEVELOPMENT_TEAM" => "",
  "LD" => "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang",
  "LDPLUSPLUS" => "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang",
  "MACOSX_DEPLOYMENT_TARGET" => "12.0",
  "MARKETING_VERSION" => "1.0",
  "PRODUCT_NAME" => "$(TARGET_NAME)",
  "SWIFT_VERSION" => "6.0"
}

configure_target(
  app_target,
  base_config: base_config,
  build_settings: common_settings.merge(
    "ASSETCATALOG_COMPILER_APPICON_NAME" => "",
    "CODE_SIGN_ENTITLEMENTS" => "",
    "GENERATE_INFOPLIST_FILE" => "NO",
    "INFOPLIST_FILE" => "QLGIS/Info.plist",
    "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @executable_path/../Frameworks",
    "PRODUCT_BUNDLE_IDENTIFIER" => "com.qlgis.QLGIS"
  )
)

configure_target(
  core_target,
  base_config: base_config,
  build_settings: common_settings.merge(
    "DEFINES_MODULE" => "YES",
    "GENERATE_INFOPLIST_FILE" => "YES",
    "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @loader_path/Frameworks @loader_path/../Frameworks",
    "PRODUCT_BUNDLE_IDENTIFIER" => "com.qlgis.QLGIS.QLGISCore",
    "SKIP_INSTALL" => "YES"
  )
)

configure_target(
  extension_target,
  base_config: base_config,
  build_settings: common_settings.merge(
    "APPLICATION_EXTENSION_API_ONLY" => "YES",
    "CODE_SIGN_ENTITLEMENTS" => "QLGISPreviewExtension/QLGISPreviewExtension.entitlements",
    "ENABLE_USER_SCRIPT_SANDBOXING" => "NO",
    "INFOPLIST_FILE" => "QLGISPreviewExtension/Info.plist",
    "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @executable_path/../Frameworks @executable_path/../../Frameworks",
    "PRODUCT_BUNDLE_IDENTIFIER" => "com.qlgis.QLGIS.QLGISPreviewExtension",
    "SKIP_INSTALL" => "YES"
  )
)

configure_target(
  test_target,
  base_config: base_config,
  build_settings: common_settings.merge(
    "BUNDLE_LOADER" => "",
    "GENERATE_INFOPLIST_FILE" => "YES",
    "LD_RUNPATH_SEARCH_PATHS" => "$(inherited) @loader_path/../Frameworks @loader_path/Frameworks",
    "PRODUCT_BUNDLE_IDENTIFIER" => "com.qlgis.QLGIS.QLGISCoreTests",
    "TEST_HOST" => ""
  )
)

tests_scheme = Xcodeproj::XCScheme.new
tests_scheme.configure_with_targets(core_target, test_target)
tests_scheme.test_action.code_coverage_enabled = true
tests_scheme.save_as(PROJECT_PATH, "QLGISCoreTests", true)

project.save
