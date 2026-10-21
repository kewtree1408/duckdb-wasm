################################################################################
# DuckDB-Wasm extension base config
################################################################################
#

duckdb_extension_load(json)
duckdb_extension_load(parquet)
duckdb_extension_load(autocomplete)

duckdb_extension_load(icu)
duckdb_extension_load(tpcds)
duckdb_extension_load(tpch)

if(DEFINED ENV{DUCKDB_HTTPFS_DIRECTORY}
   AND NOT "$ENV{DUCKDB_HTTPFS_DIRECTORY}" STREQUAL "")
    include("${EXTENSION_CONFIG_BASE_DIR}/httpfs.cmake")
endif()

if(DUCKDB_AWS_DIRECTORY)
    # DuckDB's Wasm post-link reads LINKED_LIBS instead of the extension target's linked libraries.
    set(DUCKDB_AWS_VCPKG_LIB_DIR "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/lib")
    string(CONCAT DUCKDB_AWS_LINKED_LIBS
           "-Wl,--start-group "
           "${DUCKDB_AWS_VCPKG_LIB_DIR}/libaws*.a "
           "${DUCKDB_AWS_VCPKG_LIB_DIR}/libcurl.a "
           "${DUCKDB_AWS_VCPKG_LIB_DIR}/libssl.a "
           "${DUCKDB_AWS_VCPKG_LIB_DIR}/libcrypto.a "
           "${DUCKDB_AWS_VCPKG_LIB_DIR}/libs2n.a "
           "${DUCKDB_AWS_VCPKG_LIB_DIR}/libz.a "
           "-Wl,--end-group")
    duckdb_extension_load(aws
                          SOURCE_DIR "${DUCKDB_AWS_DIRECTORY}"
                          LINKED_LIBS "${DUCKDB_AWS_LINKED_LIBS}")
endif()

# Arrow IPC reading and writing, linked statically into DuckDB-Wasm
duckdb_extension_load(nanoarrow
                      SOURCE_DIR ${DUCKDB_NANOARROW_DIR}
                      LINKED_LIBS "../../_deps/nanoarrow-build/lib*.a")
