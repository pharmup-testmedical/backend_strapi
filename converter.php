<?php

/**
* Converts Strapi v5 modules from src/api to Strapi v4 modules in src_v4/api
* Copies schema.json and generates standard controller, router, and service files
*/
function convertStrapiV5toV4($srcApiPath = 'src/api', $destApiPath = 'src_v4/api') {
    // Ensure source directory exists
    if (!is_dir($srcApiPath)) {
        echo "Source directory $srcApiPath does not exist.\n";
        return false;
    }

    // Create destination directory if it doesn't exist
    if (!is_dir($destApiPath)) {
        mkdir($destApiPath, 0755, true);
    }

    // Get all directories in src/api
    $modules = array_filter(glob($srcApiPath . '/*'), 'is_dir');

    foreach ($modules as $modulePath) {
        $moduleName = basename($modulePath);

        // Define destination module path
        $destModulePath = $destApiPath . '/' . $moduleName;
        if (!is_dir($destModulePath)) {
            mkdir($destModulePath, 0755, true);
        }

        // Create content-types directory and copy schema.json
        $schemaSrc = $modulePath . '/content-types/' . $moduleName . '/schema.json';
        $schemaDestDir = $destModulePath . '/content-types/' . $moduleName;
        $schemaDest = $schemaDestDir . '/schema.json';

        if (file_exists($schemaSrc)) {
            if (!is_dir($schemaDestDir)) {
                mkdir($schemaDestDir, 0755, true);
            }
            copy($schemaSrc, $schemaDest);
            echo "Copied schema.json for $moduleName\n";
        } else {
            echo "Warning: schema.json not found for $moduleName\n";
        }

        // Create controllers directory and controller file
        $controllerDir = $destModulePath . '/controllers';
        if (!is_dir($controllerDir)) {
            mkdir($controllerDir, 0755, true);
        }
        $controllerContent = "'use strict';\n\n";
        $controllerContent .= "/**\n * $moduleName controller\n */\n\n";
        $controllerContent .= "const { createCoreController } = require('@strapi/strapi').factories;\n\n";
        $controllerContent .= "module.exports = createCoreController('api::$moduleName.$moduleName');\n";
        file_put_contents($controllerDir . '/' . $moduleName . '.js', $controllerContent);
        echo "Created controller for $moduleName\n";

        // Create routes directory and router file
        $routesDir = $destModulePath . '/routes';
        if (!is_dir($routesDir)) {
            mkdir($routesDir, 0755, true);
        }
        $routerContent = "'use strict';\n\n";
        $routerContent .= "/**\n * $moduleName router\n */\n\n";
        $routerContent .= "const { createCoreRouter } = require('@strapi/strapi').factories;\n\n";
        $routerContent .= "module.exports = createCoreRouter('api::$moduleName.$moduleName');\n";
        file_put_contents($routesDir . '/' . $moduleName . '.js', $routerContent);
        echo "Created router for $moduleName\n";

        // Create services directory and service file
        $servicesDir = $destModulePath . '/services';
        if (!is_dir($servicesDir)) {
            mkdir($servicesDir, 0755, true);
        }
        $serviceContent = "'use strict';\n\n";
        $serviceContent .= "/**\n * $moduleName service\n */\n\n";
        $serviceContent .= "const { createCoreService } = require('@strapi/strapi').factories;\n\n";
        $serviceContent .= "module.exports = createCoreService('api::$moduleName.$moduleName');\n";
        file_put_contents($servicesDir . '/' . $moduleName . '.js', $serviceContent);
        echo "Created service for $moduleName\n";
    }

    echo "Conversion completed.\n";
    return true;
}

// Example usage
convertStrapiV5toV4('src/api', 'src_v4/api');

?>