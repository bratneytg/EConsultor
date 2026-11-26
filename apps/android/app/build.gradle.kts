plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// La dirección de tu servidor se fija al compilar (-PserverUrl=...) y se puede cambiar dentro de la app.
val serverUrl: String = (project.findProperty("serverUrl") as String?) ?: "https://hub.fable-denebola.ts.net"
val appVersionCode: Int = ((project.findProperty("versionCode") as String?) ?: "1").toInt()
val appVersionName: String = (project.findProperty("versionName") as String?) ?: "1.0.0"

android {
    namespace = "app.econsultor"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.econsultor"
        minSdk = 26
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        create("release") {
            // Con los secretos de GitHub si existen; si no, la clave de instalación personal del repositorio.
            val ks = System.getenv("ANDROID_KEYSTORE_FILE") ?: "${rootDir}/signing/econsultor-sideload.jks"
            storeFile = file(ks)
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: "econsultor-sideload"
            keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "econsultor"
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: "econsultor-sideload"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.biometric:biometric:1.1.0")
}
